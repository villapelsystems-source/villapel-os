from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt
from bson import ObjectId
import secrets
import re

ROOT_DIR = Path(__file__).parent

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Configuration
JWT_ALGORITHM = "HS256"

def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]

# Password Hashing
def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))

# JWT Token Management
def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
        "type": "access"
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "refresh"
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)

# Auth Helper
async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["_id"] = str(user["_id"])
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# Brute Force Protection
async def check_brute_force(identifier: str):
    attempt = await db.login_attempts.find_one({"identifier": identifier})
    if attempt:
        if attempt.get("locked_until") and attempt["locked_until"] > datetime.now(timezone.utc):
            raise HTTPException(status_code=429, detail="Too many failed attempts. Try again later.")
        if attempt.get("attempts", 0) >= 5:
            locked_until = datetime.now(timezone.utc) + timedelta(minutes=15)
            await db.login_attempts.update_one(
                {"identifier": identifier},
                {"$set": {"locked_until": locked_until}}
            )
            raise HTTPException(status_code=429, detail="Too many failed attempts. Locked for 15 minutes.")

async def record_failed_attempt(identifier: str):
    await db.login_attempts.update_one(
        {"identifier": identifier},
        {"$inc": {"attempts": 1}, "$set": {"last_attempt": datetime.now(timezone.utc)}},
        upsert=True
    )

async def clear_attempts(identifier: str):
    await db.login_attempts.delete_one({"identifier": identifier})

# Create the main app
app = FastAPI(title="Villapel OS API")

# Create router with /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ==================== MODELS ====================

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    role: str
    created_at: datetime

class LeadCreate(BaseModel):
    company_name: str
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    website: Optional[str] = None
    instagram_handle: Optional[str] = None
    facebook_page: Optional[str] = None
    source_platform: str = "Instagram"
    source_detail: Optional[str] = None
    status: str = "New Lead"
    priority: str = "medium"
    notes: Optional[str] = None
    assigned_to: Optional[str] = None

class LeadUpdate(BaseModel):
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    website: Optional[str] = None
    instagram_handle: Optional[str] = None
    facebook_page: Optional[str] = None
    source_platform: Optional[str] = None
    source_detail: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    notes: Optional[str] = None
    next_action_date: Optional[datetime] = None
    assigned_to: Optional[str] = None

class OutreachInstagramCreate(BaseModel):
    lead_id: str
    account_used: str
    follow_status: str = "not_followed"
    liked_posts_count: int = 0
    first_dm_sent: Optional[str] = None
    last_reply: Optional[str] = None
    conversation_status: str = "not_started"
    notes: Optional[str] = None

class OutreachFacebookGroupCreate(BaseModel):
    lead_id: Optional[str] = None
    group_name: str
    post_link: Optional[str] = None
    post_type: str = "engagement"
    comment_made: Optional[str] = None
    people_engaged: List[str] = []
    person_followed_up: Optional[str] = None
    follow_up_method: Optional[str] = None
    lead_captured: bool = False
    notes: Optional[str] = None

class MessageTemplateCreate(BaseModel):
    name: str
    category: str
    platform: str
    content: str
    variables: List[str] = []

class CallCreate(BaseModel):
    lead_id: Optional[str] = None
    caller_phone: str
    company_name: Optional[str] = None
    duration_seconds: int = 0
    outcome: str = "no_answer"
    qualified: bool = False
    booked: bool = False
    transcript_summary: Optional[str] = None
    recording_url: Optional[str] = None
    score: str = "average"

class TaskCreate(BaseModel):
    lead_id: Optional[str] = None
    task_type: str
    title: str
    description: Optional[str] = None
    due_date: datetime
    assigned_to: Optional[str] = None
    priority: str = "medium"

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[datetime] = None
    assigned_to: Optional[str] = None
    priority: Optional[str] = None
    completed: Optional[bool] = None

class BookingCreate(BaseModel):
    lead_id: str
    booking_date: datetime
    source: str
    meeting_status: str = "scheduled"
    outcome: Optional[str] = None
    notes: Optional[str] = None

class BookingUpdate(BaseModel):
    booking_date: Optional[datetime] = None
    meeting_status: Optional[str] = None
    outcome: Optional[str] = None
    notes: Optional[str] = None

class NoteCreate(BaseModel):
    content: str

# ==================== EXTERNAL API MODELS ====================

class APIKeyCreate(BaseModel):
    name: str
    permissions: List[str] = ["leads:write", "tasks:write", "bookings:write", "calls:write"]

class ExternalLeadIntake(BaseModel):
    source: str  # "clawbot", "manual", "calcom", "retell"
    channel: str  # "instagram", "facebook_group", "facebook_dm", "phone", "website", "referral"
    company_name: str
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    instagram_handle: Optional[str] = None
    facebook_page: Optional[str] = None
    facebook_group_found_in: Optional[str] = None
    website: Optional[str] = None
    location_city: Optional[str] = None
    location_state: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = []
    detected_at: Optional[str] = None

class ExternalLeadUpdate(BaseModel):
    lead_id: Optional[str] = None
    phone: Optional[str] = None
    instagram_handle: Optional[str] = None
    updates: dict

class ExternalTaskCreate(BaseModel):
    lead_id: str
    task_type: str  # "send_followup", "call_lead", "review_reply", "post_in_group", "reply_in_group", "check_booked_demo", "custom"
    title: str
    description: Optional[str] = None
    due_date: Optional[str] = None
    priority: str = "medium"
    assigned_to: Optional[str] = None
    channel: Optional[str] = None
    auto_generated: bool = True

class ExternalBookingCreate(BaseModel):
    lead_id: str
    booking_source: str  # "calcom", "manual", "clawbot"
    booking_date: str
    booking_type: Optional[str] = "demo"
    calcom_event_id: Optional[str] = None
    meeting_url: Optional[str] = None
    notes: Optional[str] = None
    status: str = "scheduled"

class ExternalCallLog(BaseModel):
    phone: str
    direction: str  # "inbound", "outbound"
    call_date: str
    duration_seconds: Optional[int] = 0
    qualified: Optional[bool] = False
    booked: Optional[bool] = False
    transcript_summary: Optional[str] = None
    recording_url: Optional[str] = None
    retell_call_id: Optional[str] = None
    notes: Optional[str] = None

# ==================== UTILITY FUNCTIONS ====================

def normalize_phone(phone: str) -> str:
    """Normalize phone number by removing spaces, dashes, parentheses"""
    if not phone:
        return ""
    return re.sub(r'[\s\-\(\)\.]', '', phone)

def normalize_instagram(handle: str) -> str:
    """Normalize Instagram handle: lowercase, remove @"""
    if not handle:
        return ""
    return handle.lower().lstrip('@').strip()

def normalize_facebook_url(url: str) -> str:
    """Normalize Facebook URL/page name"""
    if not url:
        return ""
    url = url.lower().strip()
    url = re.sub(r'^https?://(www\.)?facebook\.com/', '', url)
    url = re.sub(r'^fb\.com/', '', url)
    return url.rstrip('/')

def clean_string(val: str) -> Optional[str]:
    """Trim string, return None if empty"""
    if val is None:
        return None
    val = str(val).strip()
    return val if val else None

def add_activity(lead_id: str, action: str, details: str = None) -> dict:
    """Create activity entry for lead timeline"""
    return {
        "id": str(uuid.uuid4()),
        "action": action,
        "details": details,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

# ==================== SIMPLE API KEY AUTH (ENV VAR) ====================

def validate_api_key_simple(request: Request):
    """Validate x-api-key header against VILLAPEL_API_KEY env var"""
    api_key = request.headers.get("x-api-key") or request.headers.get("X-API-Key")
    expected_key = os.environ.get("VILLAPEL_API_KEY")
    
    if not api_key or not expected_key or api_key != expected_key:
        raise HTTPException(
            status_code=401, 
            detail={"success": False, "error": "Not authenticated"}
        )
    return True

# ==================== MAKE.COM COMPATIBLE ENDPOINTS ====================

VALID_STATUSES = [
    "New Lead", "Contacted", "Replied", "Interested", "Qualified", 
    "Booked", "No Response", "Not Interested", "Closed Won", "Closed Lost"
]

@api_router.post("/leads/intake")
async def leads_intake(request: Request):
    """
    POST /api/leads/intake
    Create or update lead with anti-duplicate logic.
    Duplicate priority: phone > instagram_handle > facebook_page
    """
    validate_api_key_simple(request)
    
    try:
        data = await request.json()
    except:
        raise HTTPException(status_code=400, detail={"success": False, "error": "Invalid JSON"})
    
    # Validate required field
    company_name = clean_string(data.get("company_name"))
    if not company_name:
        raise HTTPException(status_code=400, detail={"success": False, "error": "company_name is required"})
    
    # Extract and clean fields
    phone = clean_string(data.get("phone"))
    instagram_handle = clean_string(data.get("instagram_handle"))
    facebook_page = clean_string(data.get("facebook_page"))
    contact_name = clean_string(data.get("contact_name"))
    email = clean_string(data.get("email"))
    city = clean_string(data.get("city")) or clean_string(data.get("location_city"))
    state = clean_string(data.get("state")) or clean_string(data.get("location_state"))
    website = clean_string(data.get("website"))
    source = clean_string(data.get("source")) or "clawbot"
    channel = clean_string(data.get("channel")) or "instagram"
    notes = clean_string(data.get("notes"))
    tags = data.get("tags") or []
    
    # Normalize for matching
    norm_phone = normalize_phone(phone) if phone else None
    norm_ig = normalize_instagram(instagram_handle) if instagram_handle else None
    norm_fb = normalize_facebook_url(facebook_page) if facebook_page else None
    
    existing_lead = None
    matched_on = None
    
    # Duplicate check: phone first
    if norm_phone:
        async for lead in db.leads.find({"phone": {"$exists": True, "$ne": None}}):
            if normalize_phone(lead.get("phone", "")) == norm_phone:
                existing_lead = lead
                matched_on = "phone"
                break
    
    # Then instagram
    if not existing_lead and norm_ig:
        async for lead in db.leads.find({"instagram_handle": {"$exists": True, "$ne": None}}):
            if normalize_instagram(lead.get("instagram_handle", "")) == norm_ig:
                existing_lead = lead
                matched_on = "instagram_handle"
                break
    
    # Then facebook
    if not existing_lead and norm_fb:
        async for lead in db.leads.find({"facebook_page": {"$exists": True, "$ne": None}}):
            if normalize_facebook_url(lead.get("facebook_page", "")) == norm_fb:
                existing_lead = lead
                matched_on = "facebook_page"
                break
    
    now = datetime.now(timezone.utc).isoformat()
    
    if existing_lead:
        # UPDATE existing lead
        update_fields = {"updated_at": now, "last_contact_date": now}
        
        # Only update empty fields
        if contact_name and not existing_lead.get("contact_name"):
            update_fields["contact_name"] = contact_name
        if phone and not existing_lead.get("phone"):
            update_fields["phone"] = phone
        if email and not existing_lead.get("email"):
            update_fields["email"] = email
        if instagram_handle and not existing_lead.get("instagram_handle"):
            update_fields["instagram_handle"] = instagram_handle
        if facebook_page and not existing_lead.get("facebook_page"):
            update_fields["facebook_page"] = facebook_page
        if website and not existing_lead.get("website"):
            update_fields["website"] = website
        if city and not existing_lead.get("city"):
            update_fields["city"] = city
        if state and not existing_lead.get("state"):
            update_fields["state"] = state
        
        # Append notes
        if notes:
            existing_notes = existing_lead.get("notes") or ""
            ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
            update_fields["notes"] = f"{existing_notes}\n[{ts}] {notes}".strip()
        
        # Merge tags
        if tags:
            existing_tags = existing_lead.get("tags") or []
            update_fields["tags"] = list(set(existing_tags + tags))
        
        # Add activity
        activity = existing_lead.get("activity") or []
        activity.append(add_activity(existing_lead["id"], "updated_via_api", f"Matched on {matched_on}"))
        update_fields["activity"] = activity
        
        await db.leads.update_one({"id": existing_lead["id"]}, {"$set": update_fields})
        
        return {"success": True, "action": "updated", "lead_id": existing_lead["id"], "matched_on": matched_on}
    
    else:
        # CREATE new lead
        platform_map = {
            "instagram": "Instagram",
            "facebook_group": "Facebook Groups",
            "facebook_dm": "Facebook Groups",
            "phone": "Phone",
            "website": "Website",
            "referral": "Referral"
        }
        
        lead_id = str(uuid.uuid4())
        lead_doc = {
            "id": lead_id,
            "company_name": company_name,
            "contact_name": contact_name,
            "phone": phone,
            "email": email,
            "city": city,
            "state": state,
            "website": website,
            "instagram_handle": instagram_handle,
            "facebook_page": facebook_page,
            "source_platform": platform_map.get(channel, "Other"),
            "source_detail": f"via {source}",
            "status": "New Lead",
            "priority": "medium",
            "notes": f"[{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}] {notes}" if notes else None,
            "qualification_notes": None,
            "notes_history": [],
            "tags": tags or [],
            "first_contact_date": now,
            "last_contact_date": now,
            "next_action_date": None,
            "assigned_to": "Admin",
            "activity": [add_activity(lead_id, "created_via_api", f"Source: {source}, Channel: {channel}")],
            "created_at": now,
            "updated_at": now
        }
        
        await db.leads.insert_one(lead_doc)
        
        return {"success": True, "action": "created", "lead_id": lead_id}


@api_router.patch("/leads/{lead_id}")
async def leads_update(lead_id: str, request: Request):
    """
    PATCH /api/leads/{lead_id}
    Update existing lead with partial data.
    """
    validate_api_key_simple(request)
    
    try:
        data = await request.json()
    except:
        raise HTTPException(status_code=400, detail={"success": False, "error": "Invalid JSON"})
    
    lead = await db.leads.find_one({"id": lead_id})
    if not lead:
        raise HTTPException(status_code=404, detail={"success": False, "error": "Lead not found"})
    
    now = datetime.now(timezone.utc).isoformat()
    update_fields = {"updated_at": now}
    updated_field_names = []
    
    # Status update with validation
    if "status" in data:
        status = clean_string(data["status"])
        # Map short names
        status_map = {"Won": "Closed Won", "Lost": "Closed Lost", "New": "New Lead"}
        status = status_map.get(status, status)
        if status in VALID_STATUSES:
            update_fields["status"] = status
            updated_field_names.append("status")
    
    # Simple field updates
    simple_fields = ["contact_name", "email", "phone", "website", "city", "state", 
                     "instagram_handle", "facebook_page", "priority", "assigned_to"]
    for field in simple_fields:
        if field in data:
            update_fields[field] = clean_string(data[field])
            updated_field_names.append(field)
    
    # Notes - append with timestamp
    if "notes" in data and data["notes"]:
        existing_notes = lead.get("notes") or ""
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
        update_fields["notes"] = f"{existing_notes}\n[{ts}] {data['notes']}".strip()
        updated_field_names.append("notes")
    
    # Qualification notes
    if "qualification_notes" in data:
        update_fields["qualification_notes"] = clean_string(data["qualification_notes"])
        updated_field_names.append("qualification_notes")
    
    # Dates
    if "next_action_date" in data:
        update_fields["next_action_date"] = data["next_action_date"]
        updated_field_names.append("next_action_date")
    if "last_contact_date" in data:
        update_fields["last_contact_date"] = data["last_contact_date"]
        updated_field_names.append("last_contact_date")
    
    # Tags - merge
    if "tags" in data and data["tags"]:
        existing_tags = lead.get("tags") or []
        update_fields["tags"] = list(set(existing_tags + data["tags"]))
        updated_field_names.append("tags")
    
    # Add activity entry
    activity = lead.get("activity") or []
    activity.append(add_activity(lead_id, "updated_via_api", f"Fields: {', '.join(updated_field_names)}"))
    update_fields["activity"] = activity
    
    await db.leads.update_one({"id": lead_id}, {"$set": update_fields})
    
    return {"success": True, "lead_id": lead_id, "updated_fields": updated_field_names}


@api_router.get("/leads/search")
async def leads_search(
    request: Request,
    phone: Optional[str] = None,
    instagram_handle: Optional[str] = None,
    facebook_page: Optional[str] = None
):
    """
    GET /api/leads/search
    Search for lead by phone, instagram_handle, or facebook_page.
    Returns best match or 404.
    """
    validate_api_key_simple(request)
    
    if not phone and not instagram_handle and not facebook_page:
        raise HTTPException(status_code=400, detail={"success": False, "error": "Provide phone, instagram_handle, or facebook_page"})
    
    lead = None
    matched_on = None
    
    # Priority: phone > instagram > facebook
    if phone:
        norm_phone = normalize_phone(phone)
        async for l in db.leads.find({"phone": {"$exists": True, "$ne": None}}):
            if normalize_phone(l.get("phone", "")) == norm_phone:
                lead = l
                matched_on = "phone"
                break
    
    if not lead and instagram_handle:
        norm_ig = normalize_instagram(instagram_handle)
        async for l in db.leads.find({"instagram_handle": {"$exists": True, "$ne": None}}):
            if normalize_instagram(l.get("instagram_handle", "")) == norm_ig:
                lead = l
                matched_on = "instagram_handle"
                break
    
    if not lead and facebook_page:
        norm_fb = normalize_facebook_url(facebook_page)
        async for l in db.leads.find({"facebook_page": {"$exists": True, "$ne": None}}):
            if normalize_facebook_url(l.get("facebook_page", "")) == norm_fb:
                lead = l
                matched_on = "facebook_page"
                break
    
    if not lead:
        raise HTTPException(status_code=404, detail={"success": False, "error": "Lead not found"})
    
    # Remove MongoDB _id
    lead.pop("_id", None)
    
    return {"success": True, "matched_on": matched_on, "lead": lead}


@api_router.post("/tasks/create")
async def tasks_create(request: Request):
    """
    POST /api/tasks/create
    Create follow-up task linked to lead.
    """
    validate_api_key_simple(request)
    
    try:
        data = await request.json()
    except:
        raise HTTPException(status_code=400, detail={"success": False, "error": "Invalid JSON"})
    
    lead_id = clean_string(data.get("lead_id"))
    if not lead_id:
        raise HTTPException(status_code=400, detail={"success": False, "error": "lead_id is required"})
    
    # Verify lead exists
    lead = await db.leads.find_one({"id": lead_id})
    if not lead:
        raise HTTPException(status_code=400, detail={"success": False, "error": f"Lead not found: {lead_id}"})
    
    title = clean_string(data.get("title"))
    if not title:
        raise HTTPException(status_code=400, detail={"success": False, "error": "title is required"})
    
    now = datetime.now(timezone.utc)
    task_id = str(uuid.uuid4())
    
    task_doc = {
        "id": task_id,
        "lead_id": lead_id,
        "task_type": clean_string(data.get("task_type")) or "send_follow_up",
        "title": title,
        "description": clean_string(data.get("description")),
        "due_date": data.get("due_date") or (now + timedelta(days=1)).isoformat(),
        "assigned_to": clean_string(data.get("assigned_to")) or "Admin",
        "priority": clean_string(data.get("priority")) or "medium",
        "channel": clean_string(data.get("channel")),
        "auto_generated": data.get("auto_generated", True),
        "completed": False,
        "created_by": "API",
        "created_at": now.isoformat(),
        "updated_at": now.isoformat()
    }
    
    await db.tasks.insert_one(task_doc)
    
    # Add activity to lead
    activity = lead.get("activity") or []
    activity.append(add_activity(lead_id, "task_created", f"Task: {title}"))
    await db.leads.update_one({"id": lead_id}, {"$set": {"activity": activity, "updated_at": now.isoformat()}})
    
    return {"success": True, "task_id": task_id, "lead_id": lead_id}


@api_router.post("/bookings/create-or-update")
async def bookings_create_or_update(request: Request):
    """
    POST /api/bookings/create-or-update
    Create or update booking, update lead status to Booked.
    """
    validate_api_key_simple(request)
    
    try:
        data = await request.json()
    except:
        raise HTTPException(status_code=400, detail={"success": False, "error": "Invalid JSON"})
    
    lead_id = clean_string(data.get("lead_id"))
    if not lead_id:
        raise HTTPException(status_code=400, detail={"success": False, "error": "lead_id is required"})
    
    # Verify lead exists
    lead = await db.leads.find_one({"id": lead_id})
    if not lead:
        raise HTTPException(status_code=400, detail={"success": False, "error": f"Lead not found: {lead_id}"})
    
    booking_date = data.get("booking_date")
    if not booking_date:
        raise HTTPException(status_code=400, detail={"success": False, "error": "booking_date is required"})
    
    now = datetime.now(timezone.utc).isoformat()
    booking_source = clean_string(data.get("booking_source")) or clean_string(data.get("source")) or "manual"
    status = clean_string(data.get("status")) or "scheduled"
    
    # Check existing booking
    existing = await db.bookings.find_one({"lead_id": lead_id, "booking_date": booking_date})
    
    if existing:
        # Update existing
        update_fields = {
            "booking_source": booking_source,
            "meeting_status": status,
            "updated_at": now
        }
        if data.get("meeting_url"):
            update_fields["meeting_url"] = data["meeting_url"]
        if data.get("notes"):
            update_fields["notes"] = data["notes"]
        if data.get("calcom_event_id"):
            update_fields["calcom_event_id"] = data["calcom_event_id"]
        
        await db.bookings.update_one({"id": existing["id"]}, {"$set": update_fields})
        action = "updated"
        booking_id = existing["id"]
    else:
        # Create new
        booking_id = str(uuid.uuid4())
        booking_doc = {
            "id": booking_id,
            "lead_id": lead_id,
            "booking_date": booking_date,
            "booking_source": booking_source,
            "source": booking_source,
            "booking_type": clean_string(data.get("booking_type")) or "demo",
            "meeting_status": status,
            "calcom_event_id": clean_string(data.get("calcom_event_id")),
            "meeting_url": clean_string(data.get("meeting_url")),
            "notes": clean_string(data.get("notes")),
            "outcome": None,
            "created_at": now,
            "updated_at": now
        }
        await db.bookings.insert_one(booking_doc)
        action = "created"
    
    # Update lead status to Booked if not cancelled
    if status != "cancelled" and lead.get("status") not in ["Closed Won", "Closed Lost"]:
        activity = lead.get("activity") or []
        activity.append(add_activity(lead_id, "booking_created", f"Booking for {booking_date[:10] if len(booking_date) >= 10 else booking_date}"))
        
        await db.leads.update_one(
            {"id": lead_id},
            {"$set": {
                "status": "Booked",
                "activity": activity,
                "updated_at": now
            }}
        )
    
    return {"success": True, "booking_id": booking_id, "lead_id": lead_id, "action": action}


# ==================== LEGACY API KEY SYSTEM (Keep for UI) ====================

async def validate_api_key(request: Request, required_permission: str = None) -> dict:
    """Validate X-API-Key header and check permissions (database-stored keys)"""
    api_key = request.headers.get("X-API-Key")
    if not api_key:
        raise HTTPException(status_code=401, detail="Missing X-API-Key header")
    
    key_doc = await db.api_keys.find_one({"key": api_key, "is_active": True})
    if not key_doc:
        raise HTTPException(status_code=401, detail="Invalid or revoked API key")
    
    if required_permission and required_permission not in key_doc.get("permissions", []):
        raise HTTPException(status_code=403, detail=f"API key lacks required permission: {required_permission}")
    
    await db.api_keys.update_one(
        {"_id": key_doc["_id"]},
        {"$set": {"last_used_at": datetime.now(timezone.utc)}}
    )
    
    return key_doc

async def log_integration_call(
    endpoint: str,
    api_key_name: str,
    success: bool,
    response_code: int,
    summary: str,
    request_body: dict = None
):
    """Log external API calls for audit trail"""
    log_entry = {
        "id": str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "endpoint": endpoint,
        "source": api_key_name,
        "success": success,
        "response_code": response_code,
        "summary": summary,
        "request_preview": str(request_body)[:500] if request_body else None,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.integration_logs.insert_one(log_entry)
    
    count = await db.integration_logs.count_documents({})
    if count > 500:
        oldest = await db.integration_logs.find({}).sort("created_at", 1).limit(count - 500).to_list(count - 500)
        if oldest:
            ids_to_delete = [doc["_id"] for doc in oldest]
            await db.integration_logs.delete_many({"_id": {"$in": ids_to_delete}})

# ==================== API KEY MANAGEMENT ROUTES (JWT Protected) ====================

@api_router.post("/api-keys")
async def create_api_key(data: APIKeyCreate, request: Request):
    """Create a new API key (admin only)"""
    user = await get_current_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Generate a secure API key
    api_key = f"vp_{secrets.token_urlsafe(32)}"
    
    key_doc = {
        "id": str(uuid.uuid4()),
        "key": api_key,
        "name": data.name,
        "created_by": user["_id"],
        "is_active": True,
        "permissions": data.permissions,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_used_at": None
    }
    
    await db.api_keys.insert_one(key_doc)
    
    # Return the key ONCE - it won't be shown again
    return {
        "id": key_doc["id"],
        "name": key_doc["name"],
        "key": api_key,  # Only shown once!
        "permissions": key_doc["permissions"],
        "message": "Save this key securely - it won't be shown again!"
    }

@api_router.get("/api-keys")
async def list_api_keys(request: Request):
    """List all API keys (masked)"""
    user = await get_current_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    keys = await db.api_keys.find({}, {"_id": 0}).to_list(100)
    
    # Mask the keys
    for key in keys:
        if key.get("key"):
            key["key_preview"] = key["key"][:7] + "..." + key["key"][-4:]
            del key["key"]
    
    return {"api_keys": keys}

@api_router.delete("/api-keys/{key_id}")
async def revoke_api_key(key_id: str, request: Request):
    """Revoke an API key"""
    user = await get_current_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    result = await db.api_keys.update_one(
        {"id": key_id},
        {"$set": {"is_active": False, "revoked_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="API key not found")
    
    return {"message": "API key revoked", "id": key_id}

@api_router.get("/integration-logs")
async def get_integration_logs(request: Request, limit: int = 100):
    """Get recent integration logs"""
    user = await get_current_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    logs = await db.integration_logs.find({}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return {"logs": logs}

# ==================== EXTERNAL API ROUTES (API Key Protected) ====================

@api_router.post("/external/leads/intake", status_code=201)
async def external_lead_intake(data: ExternalLeadIntake, request: Request):
    """Receive a new lead from Clawbot/Make.com with deduplication"""
    api_key = await validate_api_key(request, "leads:write")
    
    try:
        # Normalize identifiers for matching
        normalized_phone = normalize_phone(data.phone) if data.phone else None
        normalized_ig = normalize_instagram(data.instagram_handle) if data.instagram_handle else None
        normalized_fb = normalize_facebook_url(data.facebook_page) if data.facebook_page else None
        
        existing_lead = None
        matched_on = None
        
        # Deduplication cascade
        # 1. Match by phone
        if normalized_phone:
            # Find leads and check normalized phone
            async for lead in db.leads.find({"phone": {"$exists": True, "$ne": None}}):
                if normalize_phone(lead.get("phone", "")) == normalized_phone:
                    existing_lead = lead
                    matched_on = "phone"
                    break
        
        # 2. Match by Instagram handle
        if not existing_lead and normalized_ig:
            async for lead in db.leads.find({"instagram_handle": {"$exists": True, "$ne": None}}):
                if normalize_instagram(lead.get("instagram_handle", "")) == normalized_ig:
                    existing_lead = lead
                    matched_on = "instagram_handle"
                    break
        
        # 3. Match by Facebook page
        if not existing_lead and normalized_fb:
            async for lead in db.leads.find({"facebook_page": {"$exists": True, "$ne": None}}):
                if normalize_facebook_url(lead.get("facebook_page", "")) == normalized_fb:
                    existing_lead = lead
                    matched_on = "facebook_page"
                    break
        
        now = datetime.now(timezone.utc).isoformat()
        
        if existing_lead:
            # Update existing lead with new non-empty fields
            update_fields = {}
            
            if data.contact_name and not existing_lead.get("contact_name"):
                update_fields["contact_name"] = data.contact_name
            if data.phone and not existing_lead.get("phone"):
                update_fields["phone"] = data.phone
            if data.email and not existing_lead.get("email"):
                update_fields["email"] = data.email
            if data.instagram_handle and not existing_lead.get("instagram_handle"):
                update_fields["instagram_handle"] = data.instagram_handle
            if data.facebook_page and not existing_lead.get("facebook_page"):
                update_fields["facebook_page"] = data.facebook_page
            if data.website and not existing_lead.get("website"):
                update_fields["website"] = data.website
            if data.location_city and not existing_lead.get("city"):
                update_fields["city"] = data.location_city
            if data.location_state and not existing_lead.get("state"):
                update_fields["state"] = data.location_state
            
            # Append notes (never replace)
            if data.notes:
                existing_notes = existing_lead.get("notes", "") or ""
                timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
                new_note = f"\n[{timestamp}] {data.notes}" if existing_notes else f"[{timestamp}] {data.notes}"
                update_fields["notes"] = existing_notes + new_note
            
            # Merge tags (deduplicate)
            if data.tags:
                existing_tags = existing_lead.get("tags", []) or []
                merged_tags = list(set(existing_tags + data.tags))
                update_fields["tags"] = merged_tags
            
            update_fields["updated_at"] = now
            update_fields["last_contact_date"] = now
            
            if update_fields:
                await db.leads.update_one({"id": existing_lead["id"]}, {"$set": update_fields})
            
            await log_integration_call(
                endpoint="/api/external/leads/intake",
                api_key_name=api_key["name"],
                success=True,
                response_code=200,
                summary=f"Lead updated: {existing_lead['company_name']} (matched on {matched_on})",
                request_body=data.model_dump()
            )
            
            return {
                "success": True,
                "action": "updated",
                "lead_id": existing_lead["id"],
                "matched_on": matched_on,
                "message": "Existing lead updated"
            }
        
        else:
            # Create new lead
            # Map channel to source_platform
            platform_map = {
                "instagram": "Instagram",
                "facebook_group": "Facebook Groups",
                "facebook_dm": "Facebook Groups",
                "phone": "Phone",
                "website": "Website",
                "referral": "Referral"
            }
            
            lead_doc = {
                "id": str(uuid.uuid4()),
                "company_name": data.company_name,
                "contact_name": data.contact_name,
                "phone": data.phone,
                "email": data.email,
                "city": data.location_city,
                "state": data.location_state,
                "website": data.website,
                "instagram_handle": data.instagram_handle,
                "facebook_page": data.facebook_page,
                "source_platform": platform_map.get(data.channel, "Other"),
                "source_detail": f"via {data.source}" + (f" from group: {data.facebook_group_found_in}" if data.facebook_group_found_in else ""),
                "status": "New Lead",
                "priority": "medium",
                "notes": f"[{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}] {data.notes}" if data.notes else None,
                "notes_history": [],
                "tags": data.tags or [],
                "first_contact_date": data.detected_at or now,
                "last_contact_date": now,
                "next_action_date": None,
                "assigned_to": "Admin",
                "created_at": now,
                "updated_at": now
            }
            
            await db.leads.insert_one(lead_doc)
            
            await log_integration_call(
                endpoint="/api/external/leads/intake",
                api_key_name=api_key["name"],
                success=True,
                response_code=201,
                summary=f"Lead created: {data.company_name}",
                request_body=data.model_dump()
            )
            
            return {
                "success": True,
                "action": "created",
                "lead_id": lead_doc["id"],
                "message": "New lead created"
            }
    
    except Exception as e:
        await log_integration_call(
            endpoint="/api/external/leads/intake",
            api_key_name=api_key["name"],
            success=False,
            response_code=500,
            summary=f"Error: {str(e)}",
            request_body=data.model_dump()
        )
        raise HTTPException(status_code=500, detail=str(e))

@api_router.patch("/external/leads/update")
async def external_lead_update(data: ExternalLeadUpdate, request: Request):
    """Update an existing lead from Make.com"""
    api_key = await validate_api_key(request, "leads:write")
    
    try:
        # Find lead by lead_id, phone, or instagram_handle
        lead = None
        
        if data.lead_id:
            lead = await db.leads.find_one({"id": data.lead_id})
        
        if not lead and data.phone:
            normalized_phone = normalize_phone(data.phone)
            async for l in db.leads.find({"phone": {"$exists": True, "$ne": None}}):
                if normalize_phone(l.get("phone", "")) == normalized_phone:
                    lead = l
                    break
        
        if not lead and data.instagram_handle:
            normalized_ig = normalize_instagram(data.instagram_handle)
            async for l in db.leads.find({"instagram_handle": {"$exists": True, "$ne": None}}):
                if normalize_instagram(l.get("instagram_handle", "")) == normalized_ig:
                    lead = l
                    break
        
        if not lead:
            await log_integration_call(
                endpoint="/api/external/leads/update",
                api_key_name=api_key["name"],
                success=False,
                response_code=404,
                summary="Lead not found with provided identifiers",
                request_body=data.model_dump()
            )
            raise HTTPException(status_code=404, detail="Lead not found with provided identifiers")
        
        updates = data.updates
        update_fields = {}
        updated_field_names = []
        
        # Map incoming status names to internal status names
        status_map = {
            "New": "New Lead",
            "Contacted": "Contacted",
            "Replied": "Replied",
            "Interested": "Interested",
            "Qualified": "Qualified",
            "Booked": "Booked",
            "Won": "Closed Won",
            "Lost": "Closed Lost",
            "Not Interested": "Not Interested"
        }
        
        if "status" in updates:
            update_fields["status"] = status_map.get(updates["status"], updates["status"])
            updated_field_names.append("status")
        
        # Append notes with timestamp (never replace)
        if "notes" in updates and updates["notes"]:
            existing_notes = lead.get("notes", "") or ""
            timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
            new_note = f"\n[{timestamp}] {updates['notes']}" if existing_notes else f"[{timestamp}] {updates['notes']}"
            update_fields["notes"] = existing_notes + new_note
            updated_field_names.append("notes")
        
        if "last_contact_date" in updates:
            update_fields["last_contact_date"] = updates["last_contact_date"]
            updated_field_names.append("last_contact_date")
        
        if "next_action_date" in updates:
            update_fields["next_action_date"] = updates["next_action_date"]
            updated_field_names.append("next_action_date")
        
        if "qualification_notes" in updates:
            update_fields["qualification_notes"] = updates["qualification_notes"]
            updated_field_names.append("qualification_notes")
        
        # Merge tags (deduplicate)
        if "tags" in updates and updates["tags"]:
            existing_tags = lead.get("tags", []) or []
            merged_tags = list(set(existing_tags + updates["tags"]))
            update_fields["tags"] = merged_tags
            updated_field_names.append("tags")
        
        # Simple field updates
        for field in ["contact_name", "email", "phone", "website"]:
            if field in updates and updates[field]:
                update_fields[field] = updates[field]
                updated_field_names.append(field)
        
        update_fields["updated_at"] = datetime.now(timezone.utc).isoformat()
        
        await db.leads.update_one({"id": lead["id"]}, {"$set": update_fields})
        
        await log_integration_call(
            endpoint="/api/external/leads/update",
            api_key_name=api_key["name"],
            success=True,
            response_code=200,
            summary=f"Lead updated: {lead['company_name']} - fields: {', '.join(updated_field_names)}",
            request_body=data.model_dump()
        )
        
        return {
            "success": True,
            "lead_id": lead["id"],
            "updated_fields": updated_field_names,
            "message": "Lead updated"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        await log_integration_call(
            endpoint="/api/external/leads/update",
            api_key_name=api_key["name"],
            success=False,
            response_code=500,
            summary=f"Error: {str(e)}",
            request_body=data.model_dump()
        )
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/external/tasks/create", status_code=201)
async def external_task_create(data: ExternalTaskCreate, request: Request):
    """Create a follow-up task from Make.com"""
    api_key = await validate_api_key(request, "tasks:write")
    
    try:
        # Validate lead exists
        lead = await db.leads.find_one({"id": data.lead_id})
        if not lead:
            await log_integration_call(
                endpoint="/api/external/tasks/create",
                api_key_name=api_key["name"],
                success=False,
                response_code=400,
                summary=f"Lead not found: {data.lead_id}",
                request_body=data.model_dump()
            )
            raise HTTPException(status_code=400, detail=f"Lead not found: {data.lead_id}")
        
        now = datetime.now(timezone.utc)
        due_date = data.due_date or (now + timedelta(days=1)).isoformat()
        
        task_doc = {
            "id": str(uuid.uuid4()),
            "lead_id": data.lead_id,
            "task_type": data.task_type,
            "title": data.title,
            "description": data.description,
            "due_date": due_date,
            "assigned_to": data.assigned_to or "Admin",
            "priority": data.priority,
            "channel": data.channel,
            "auto_generated": data.auto_generated,
            "completed": False,
            "created_by": f"API: {api_key['name']}",
            "created_at": now.isoformat(),
            "updated_at": now.isoformat()
        }
        
        await db.tasks.insert_one(task_doc)
        
        await log_integration_call(
            endpoint="/api/external/tasks/create",
            api_key_name=api_key["name"],
            success=True,
            response_code=201,
            summary=f"Task created: {data.title} for lead {lead['company_name']}",
            request_body=data.model_dump()
        )
        
        return {
            "success": True,
            "task_id": task_doc["id"],
            "lead_id": data.lead_id,
            "message": "Task created"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        await log_integration_call(
            endpoint="/api/external/tasks/create",
            api_key_name=api_key["name"],
            success=False,
            response_code=500,
            summary=f"Error: {str(e)}",
            request_body=data.model_dump()
        )
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/external/bookings/create-or-update", status_code=201)
async def external_booking_create_or_update(data: ExternalBookingCreate, request: Request):
    """Create or update a booking from Cal.com/Make.com"""
    api_key = await validate_api_key(request, "bookings:write")
    
    try:
        # Validate lead exists
        lead = await db.leads.find_one({"id": data.lead_id})
        if not lead:
            await log_integration_call(
                endpoint="/api/external/bookings/create-or-update",
                api_key_name=api_key["name"],
                success=False,
                response_code=400,
                summary=f"Lead not found: {data.lead_id}",
                request_body=data.model_dump()
            )
            raise HTTPException(status_code=400, detail=f"Lead not found: {data.lead_id}")
        
        now = datetime.now(timezone.utc).isoformat()
        
        # Check if booking exists with same lead_id and booking_date
        existing_booking = await db.bookings.find_one({
            "lead_id": data.lead_id,
            "booking_date": data.booking_date
        })
        
        if existing_booking:
            # Update existing booking
            update_fields = {
                "booking_source": data.booking_source,
                "booking_type": data.booking_type,
                "meeting_status": data.status,
                "updated_at": now
            }
            if data.calcom_event_id:
                update_fields["calcom_event_id"] = data.calcom_event_id
            if data.meeting_url:
                update_fields["meeting_url"] = data.meeting_url
            if data.notes:
                update_fields["notes"] = data.notes
            
            await db.bookings.update_one({"id": existing_booking["id"]}, {"$set": update_fields})
            action = "updated"
            booking_id = existing_booking["id"]
        else:
            # Create new booking
            booking_doc = {
                "id": str(uuid.uuid4()),
                "lead_id": data.lead_id,
                "booking_date": data.booking_date,
                "booking_source": data.booking_source,
                "booking_type": data.booking_type,
                "source": data.booking_source,
                "meeting_status": data.status,
                "calcom_event_id": data.calcom_event_id,
                "meeting_url": data.meeting_url,
                "notes": data.notes,
                "outcome": None,
                "created_at": now,
                "updated_at": now
            }
            await db.bookings.insert_one(booking_doc)
            action = "created"
            booking_id = booking_doc["id"]
        
        # Update lead status to Booked (unless booking is cancelled)
        if data.status != "cancelled":
            # Add note about booking
            existing_notes = lead.get("notes", "") or ""
            booking_date_formatted = data.booking_date[:10] if len(data.booking_date) >= 10 else data.booking_date
            timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
            new_note = f"\n[{timestamp}] Demo booked for {booking_date_formatted} via {data.booking_source}"
            
            await db.leads.update_one(
                {"id": data.lead_id},
                {"$set": {
                    "status": "Booked",
                    "notes": existing_notes + new_note,
                    "updated_at": now
                }}
            )
        
        await log_integration_call(
            endpoint="/api/external/bookings/create-or-update",
            api_key_name=api_key["name"],
            success=True,
            response_code=201 if action == "created" else 200,
            summary=f"Booking {action}: {lead['company_name']} on {data.booking_date[:10]}",
            request_body=data.model_dump()
        )
        
        return {
            "success": True,
            "action": action,
            "booking_id": booking_id,
            "lead_id": data.lead_id,
            "message": f"Booking {action}, lead status updated to Booked"
        }
    
    except HTTPException:
        raise
    except Exception as e:
        await log_integration_call(
            endpoint="/api/external/bookings/create-or-update",
            api_key_name=api_key["name"],
            success=False,
            response_code=500,
            summary=f"Error: {str(e)}",
            request_body=data.model_dump()
        )
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/external/calls/log", status_code=201)
async def external_call_log(data: ExternalCallLog, request: Request):
    """Log a call from Retell AI via Make.com"""
    api_key = await validate_api_key(request, "calls:write")
    
    try:
        now = datetime.now(timezone.utc).isoformat()
        
        # Try to match lead by phone
        matched_lead = None
        normalized_phone = normalize_phone(data.phone)
        
        async for lead in db.leads.find({"phone": {"$exists": True, "$ne": None}}):
            if normalize_phone(lead.get("phone", "")) == normalized_phone:
                matched_lead = lead
                break
        
        # Create call record
        call_doc = {
            "id": str(uuid.uuid4()),
            "lead_id": matched_lead["id"] if matched_lead else None,
            "caller_phone": data.phone,
            "company_name": matched_lead["company_name"] if matched_lead else None,
            "direction": data.direction,
            "call_date": data.call_date,
            "duration_seconds": data.duration_seconds or 0,
            "outcome": "booked" if data.booked else ("qualified" if data.qualified else "answered"),
            "qualified": data.qualified or False,
            "booked": data.booked or False,
            "transcript_summary": data.transcript_summary,
            "recording_url": data.recording_url,
            "retell_call_id": data.retell_call_id,
            "notes": data.notes,
            "score": "good" if data.booked else ("average" if data.qualified else "average"),
            "created_at": now
        }
        
        await db.calls.insert_one(call_doc)
        
        # Update lead if matched
        if matched_lead:
            lead_updates = {"last_contact_date": now, "updated_at": now}
            
            # Update status based on call outcome
            if data.booked:
                lead_updates["status"] = "Booked"
            elif data.qualified and matched_lead.get("status") not in ["Booked", "Closed Won"]:
                lead_updates["status"] = "Qualified"
            
            await db.leads.update_one({"id": matched_lead["id"]}, {"$set": lead_updates})
        
        await log_integration_call(
            endpoint="/api/external/calls/log",
            api_key_name=api_key["name"],
            success=True,
            response_code=201,
            summary=f"Call logged: {data.phone}" + (f" - matched to {matched_lead['company_name']}" if matched_lead else " - no lead match"),
            request_body=data.model_dump()
        )
        
        return {
            "success": True,
            "call_id": call_doc["id"],
            "matched_lead_id": matched_lead["id"] if matched_lead else None,
            "message": "Call logged" + (" and linked to lead" if matched_lead else "")
        }
    
    except Exception as e:
        await log_integration_call(
            endpoint="/api/external/calls/log",
            api_key_name=api_key["name"],
            success=False,
            response_code=500,
            summary=f"Error: {str(e)}",
            request_body=data.model_dump()
        )
        raise HTTPException(status_code=500, detail=str(e))

# ==================== AUTH ROUTES ====================

@api_router.post("/auth/register")
async def register(user_data: UserCreate, response: Response):
    email = user_data.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    password_hash = hash_password(user_data.password)
    user_doc = {
        "email": email,
        "password_hash": password_hash,
        "name": user_data.name,
        "role": "team_member",
        "created_at": datetime.now(timezone.utc)
    }
    result = await db.users.insert_one(user_doc)
    user_id = str(result.inserted_id)
    
    access_token = create_access_token(user_id, email)
    refresh_token = create_refresh_token(user_id)
    
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=os.environ.get("COOKIE_SECURE", "false").lower() == "true", samesite="lax", max_age=900, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=os.environ.get("COOKIE_SECURE", "false").lower() == "true", samesite="lax", max_age=604800, path="/")
    
    return {"id": user_id, "email": email, "name": user_data.name, "role": "team_member"}

@api_router.post("/auth/login")
async def login(user_data: UserLogin, request: Request, response: Response):
    email = user_data.email.lower()
    ip = request.client.host if request.client else "unknown"
    identifier = f"{ip}:{email}"
    
    await check_brute_force(identifier)
    
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(user_data.password, user["password_hash"]):
        await record_failed_attempt(identifier)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    await clear_attempts(identifier)
    
    user_id = str(user["_id"])
    access_token = create_access_token(user_id, email)
    refresh_token = create_refresh_token(user_id)
    
    response.set_cookie(key="access_token", value=access_token, httponly=True, secure=os.environ.get("COOKIE_SECURE", "false").lower() == "true", samesite="lax", max_age=900, path="/")
    response.set_cookie(key="refresh_token", value=refresh_token, httponly=True, secure=os.environ.get("COOKIE_SECURE", "false").lower() == "true", samesite="lax", max_age=604800, path="/")
    
    return {"id": user_id, "email": user["email"], "name": user["name"], "role": user["role"]}

@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out successfully"}

@api_router.get("/auth/me")
async def get_me(request: Request):
    user = await get_current_user(request)
    return user

@api_router.post("/auth/refresh")
async def refresh_token(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        
        user_id = str(user["_id"])
        access_token = create_access_token(user_id, user["email"])
        response.set_cookie(key="access_token", value=access_token, httponly=True, secure=os.environ.get("COOKIE_SECURE", "false").lower() == "true", samesite="lax", max_age=900, path="/")
        return {"message": "Token refreshed"}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

# ==================== LEADS ROUTES ====================

@api_router.get("/leads")
async def get_leads(
    request: Request,
    status: Optional[str] = None,
    source_platform: Optional[str] = None,
    priority: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 50
):
    await get_current_user(request)
    
    query = {}
    if status:
        query["status"] = status
    if source_platform:
        query["source_platform"] = source_platform
    if priority:
        query["priority"] = priority
    if search:
        query["$or"] = [
            {"company_name": {"$regex": search, "$options": "i"}},
            {"contact_name": {"$regex": search, "$options": "i"}},
            {"phone": {"$regex": search, "$options": "i"}},
            {"email": {"$regex": search, "$options": "i"}},
            {"city": {"$regex": search, "$options": "i"}}
        ]
    
    leads = await db.leads.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    total = await db.leads.count_documents(query)
    
    return {"leads": leads, "total": total}

@api_router.get("/leads/{lead_id}")
async def get_lead(lead_id: str, request: Request):
    await get_current_user(request)
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead

@api_router.post("/leads")
async def create_lead(lead_data: LeadCreate, request: Request):
    await get_current_user(request)
    
    # Duplicate check by phone or social handle
    if lead_data.phone:
        existing = await db.leads.find_one({"phone": lead_data.phone})
        if existing:
            raise HTTPException(status_code=400, detail="Lead with this phone number already exists")
    if lead_data.instagram_handle:
        existing = await db.leads.find_one({"instagram_handle": lead_data.instagram_handle})
        if existing:
            raise HTTPException(status_code=400, detail="Lead with this Instagram handle already exists")
    
    lead_doc = lead_data.model_dump()
    lead_doc["id"] = str(uuid.uuid4())
    lead_doc["first_contact_date"] = None
    lead_doc["last_contact_date"] = None
    lead_doc["next_action_date"] = None
    lead_doc["created_at"] = datetime.now(timezone.utc).isoformat()
    lead_doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    await db.leads.insert_one(lead_doc)
    lead_doc.pop("_id", None)
    return lead_doc

@api_router.put("/leads/{lead_id}")
async def update_lead(lead_id: str, lead_data: LeadUpdate, request: Request):
    await get_current_user(request)
    
    update_data = {k: v for k, v in lead_data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No update data provided")
    
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    
    result = await db.leads.update_one({"id": lead_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    lead = await db.leads.find_one({"id": lead_id}, {"_id": 0})
    return lead

@api_router.delete("/leads/{lead_id}")
async def delete_lead(lead_id: str, request: Request):
    await get_current_user(request)
    lead = await db.leads.find_one({"id": lead_id})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    tr = await db.tasks.delete_many({"lead_id": lead_id})
    br = await db.bookings.delete_many({"lead_id": lead_id})
    cr = await db.calls.delete_many({"lead_id": lead_id})
    await db.leads.delete_one({"id": lead_id})
    return {
        "message": "Lead deleted",
        "cascaded": {"tasks": tr.deleted_count, "bookings": br.deleted_count, "calls": cr.deleted_count},
    }

@api_router.post("/leads/{lead_id}/notes")
async def add_lead_note(lead_id: str, note_data: NoteCreate, request: Request):
    user = await get_current_user(request)
    
    note = {
        "id": str(uuid.uuid4()),
        "content": note_data.content,
        "created_by": user["name"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    result = await db.leads.update_one(
        {"id": lead_id},
        {
            "$push": {"notes_history": note},
            "$set": {"notes": note_data.content, "updated_at": datetime.now(timezone.utc).isoformat()}
        }
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Lead not found")
    return note

# ==================== OUTREACH INSTAGRAM ROUTES ====================

@api_router.get("/outreach/instagram")
async def get_instagram_outreach(request: Request, skip: int = 0, limit: int = 50):
    await get_current_user(request)
    records = await db.outreach_instagram.find({}, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    total = await db.outreach_instagram.count_documents({})
    return {"records": records, "total": total}

@api_router.post("/outreach/instagram")
async def create_instagram_outreach(data: OutreachInstagramCreate, request: Request):
    await get_current_user(request)
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["date_contacted"] = datetime.now(timezone.utc).isoformat()
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    doc["timeline"] = [{
        "action": "created",
        "date": datetime.now(timezone.utc).isoformat(),
        "details": "Outreach record created"
    }]
    await db.outreach_instagram.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.put("/outreach/instagram/{record_id}")
async def update_instagram_outreach(record_id: str, data: dict, request: Request):
    await get_current_user(request)
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.outreach_instagram.update_one({"id": record_id}, {"$set": data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Record not found")
    record = await db.outreach_instagram.find_one({"id": record_id}, {"_id": 0})
    return record

# ==================== OUTREACH FACEBOOK GROUPS ROUTES ====================

@api_router.get("/outreach/facebook-groups")
async def get_facebook_groups_outreach(request: Request, skip: int = 0, limit: int = 50):
    await get_current_user(request)
    records = await db.outreach_facebook_groups.find({}, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    total = await db.outreach_facebook_groups.count_documents({})
    return {"records": records, "total": total}

@api_router.post("/outreach/facebook-groups")
async def create_facebook_group_outreach(data: OutreachFacebookGroupCreate, request: Request):
    await get_current_user(request)
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    doc["timeline"] = [{
        "action": "created",
        "date": datetime.now(timezone.utc).isoformat(),
        "details": "Facebook group outreach record created"
    }]
    await db.outreach_facebook_groups.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.put("/outreach/facebook-groups/{record_id}")
async def update_facebook_group_outreach(record_id: str, data: dict, request: Request):
    await get_current_user(request)
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.outreach_facebook_groups.update_one({"id": record_id}, {"$set": data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Record not found")
    record = await db.outreach_facebook_groups.find_one({"id": record_id}, {"_id": 0})
    return record

# ==================== MESSAGE TEMPLATES ROUTES ====================

@api_router.get("/templates")
async def get_templates(request: Request, category: Optional[str] = None, platform: Optional[str] = None):
    await get_current_user(request)
    query = {}
    if category:
        query["category"] = category
    if platform:
        query["platform"] = platform
    templates = await db.message_templates.find(query, {"_id": 0}).sort("name", 1).to_list(100)
    return {"templates": templates}

@api_router.post("/templates")
async def create_template(data: MessageTemplateCreate, request: Request):
    await get_current_user(request)
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.message_templates.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.put("/templates/{template_id}")
async def update_template(template_id: str, data: dict, request: Request):
    await get_current_user(request)
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.message_templates.update_one({"id": template_id}, {"$set": data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    template = await db.message_templates.find_one({"id": template_id}, {"_id": 0})
    return template

@api_router.delete("/templates/{template_id}")
async def delete_template(template_id: str, request: Request):
    await get_current_user(request)
    result = await db.message_templates.delete_one({"id": template_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"message": "Template deleted"}

# ==================== CALLS ROUTES ====================

@api_router.get("/calls")
async def get_calls(request: Request, outcome: Optional[str] = None, score: Optional[str] = None, skip: int = 0, limit: int = 50):
    await get_current_user(request)
    query = {}
    if outcome:
        query["outcome"] = outcome
    if score:
        query["score"] = score
    calls = await db.calls.find(query, {"_id": 0}).sort("call_date", -1).skip(skip).limit(limit).to_list(limit)
    total = await db.calls.count_documents(query)
    return {"calls": calls, "total": total}

@api_router.get("/calls/{call_id}")
async def get_call(call_id: str, request: Request):
    await get_current_user(request)
    call = await db.calls.find_one({"id": call_id}, {"_id": 0})
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    return call

@api_router.post("/calls")
async def create_call(data: CallCreate, request: Request):
    await get_current_user(request)
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["call_date"] = datetime.now(timezone.utc).isoformat()
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.calls.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.put("/calls/{call_id}")
async def update_call(call_id: str, data: dict, request: Request):
    await get_current_user(request)
    result = await db.calls.update_one({"id": call_id}, {"$set": data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Call not found")
    call = await db.calls.find_one({"id": call_id}, {"_id": 0})
    return call


@api_router.delete("/calls/{call_id}")
async def delete_call(call_id: str, request: Request):
    await get_current_user(request)
    result = await db.calls.delete_one({"id": call_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Call not found")
    return {"message": "Call deleted"}

# ==================== TASKS ROUTES ====================

@api_router.get("/tasks")
async def get_tasks(request: Request, task_type: Optional[str] = None, completed: Optional[bool] = None, skip: int = 0, limit: int = 50):
    await get_current_user(request)
    query = {}
    if task_type:
        query["task_type"] = task_type
    if completed is not None:
        query["completed"] = completed
    tasks = await db.tasks.find(query, {"_id": 0}).sort("due_date", 1).skip(skip).limit(limit).to_list(limit)
    total = await db.tasks.count_documents(query)
    return {"tasks": tasks, "total": total}

@api_router.post("/tasks")
async def create_task(data: TaskCreate, request: Request):
    user = await get_current_user(request)
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["due_date"] = data.due_date.isoformat() if data.due_date else None
    doc["completed"] = False
    doc["created_by"] = user["name"]
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.tasks.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.put("/tasks/{task_id}")
async def update_task(task_id: str, data: TaskUpdate, request: Request):
    await get_current_user(request)
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if "due_date" in update_data and update_data["due_date"]:
        update_data["due_date"] = update_data["due_date"].isoformat()
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.tasks.update_one({"id": task_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    task = await db.tasks.find_one({"id": task_id}, {"_id": 0})
    return task

@api_router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, request: Request):
    await get_current_user(request)
    result = await db.tasks.delete_one({"id": task_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "Task deleted"}

# ==================== BOOKINGS ROUTES ====================

@api_router.get("/bookings")
async def get_bookings(request: Request, meeting_status: Optional[str] = None, skip: int = 0, limit: int = 50):
    await get_current_user(request)
    query = {}
    if meeting_status:
        query["meeting_status"] = meeting_status
    bookings = await db.bookings.find(query, {"_id": 0}).sort("booking_date", -1).skip(skip).limit(limit).to_list(limit)
    total = await db.bookings.count_documents(query)
    return {"bookings": bookings, "total": total}

@api_router.post("/bookings")
async def create_booking(data: BookingCreate, request: Request):
    await get_current_user(request)
    doc = data.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["booking_date"] = data.booking_date.isoformat()
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.bookings.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.put("/bookings/{booking_id}")
async def update_booking(booking_id: str, data: BookingUpdate, request: Request):
    await get_current_user(request)
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if "booking_date" in update_data and update_data["booking_date"]:
        update_data["booking_date"] = update_data["booking_date"].isoformat()
    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.bookings.update_one({"id": booking_id}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Booking not found")
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    return booking


@api_router.delete("/bookings/{booking_id}")
async def delete_booking(booking_id: str, request: Request):
    await get_current_user(request)
    result = await db.bookings.delete_one({"id": booking_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Booking not found")
    return {"message": "Booking deleted"}

# ==================== AUTOMATIONS ROUTES ====================

@api_router.get("/automations")
async def get_automations(request: Request):
    await get_current_user(request)
    automations = await db.automations.find({}, {"_id": 0}).to_list(100)
    return {"automations": automations}

@api_router.put("/automations/{automation_id}")
async def update_automation(automation_id: str, data: dict, request: Request):
    await get_current_user(request)
    result = await db.automations.update_one({"id": automation_id}, {"$set": data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Automation not found")
    automation = await db.automations.find_one({"id": automation_id}, {"_id": 0})
    return automation

# ==================== DAY ACTIVITY ====================

def _utc_day_bounds(date_str: str):
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        return None
    start_naive = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    start = start_naive.isoformat().replace("+00:00", "Z")
    next_start = (start_naive + timedelta(days=1)).isoformat().replace("+00:00", "Z")
    return start, next_start


@api_router.get("/activity/day")
async def get_activity_day(request: Request, date: str):
    await get_current_user(request)
    bounds = _utc_day_bounds(date)
    if not bounds:
        raise HTTPException(status_code=400, detail="Invalid date: use YYYY-MM-DD")
    start, next_start = bounds

    def _ts(val):
        if val is None:
            return 0.0
        if isinstance(val, datetime):
            return val.timestamp()
        s = str(val).replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(s).timestamp()
        except ValueError:
            return 0.0

    items = []

    leads_created = await db.leads.find(
        {"created_at": {"$gte": start, "$lt": next_start}}, {"_id": 0}
    ).to_list(500)
    for l in leads_created:
        notes = str(l.get("notes") or "")
        label = " · ".join(x for x in [l.get("company_name"), l.get("contact_name")] if x) or "Lead"
        items.append({
            "id": f"lead-created-{l['id']}",
            "kind": "lead",
            "activity_subtype": "created",
            "at": l["created_at"],
            "entity_id": l["id"],
            "lead_id": l["id"],
            "contact_label": label,
            "platform": l.get("source_platform") or "—",
            "status": l.get("status") or "—",
            "summary": notes[:160],
            "detail_route": f"/leads/{l['id']}",
        })

    leads_touched = await db.leads.find(
        {"updated_at": {"$gte": start, "$lt": next_start}}, {"_id": 0}
    ).to_list(500)

    for l in leads_touched:
        u = l.get("updated_at")
        c = l.get("created_at")
        if not u:
            continue
        if _ts(u) <= _ts(c):
            continue
        label = " · ".join(x for x in [l.get("company_name"), l.get("contact_name")] if x) or "Lead"
        notes = str(l.get("notes") or "")
        items.append({
            "id": f"lead-updated-{l['id']}-{u}",
            "kind": "lead",
            "activity_subtype": "updated",
            "at": u,
            "entity_id": l["id"],
            "lead_id": l["id"],
            "contact_label": label,
            "platform": l.get("source_platform") or "—",
            "status": l.get("status") or "—",
            "summary": notes[:160],
            "detail_route": f"/leads/{l['id']}",
        })

    calls = await db.calls.find(
        {"call_date": {"$gte": start, "$lt": next_start}}, {"_id": 0}
    ).to_list(500)
    for c in calls:
        label = c.get("company_name") or c.get("caller_phone") or "Call"
        summ = str(c.get("transcript_summary") or c.get("notes") or "")[:160]
        oc = c.get("outcome") or "call"
        items.append({
            "id": f"call-{c['id']}",
            "kind": "call",
            "activity_subtype": oc,
            "at": c["call_date"],
            "entity_id": c["id"],
            "lead_id": c.get("lead_id"),
            "contact_label": label,
            "platform": "Phone" if c.get("caller_phone") else "—",
            "status": str(oc).replace("_", " ") if oc else "—",
            "summary": summ,
            "detail_route": "/calls",
        })

    bookings = await db.bookings.find(
        {"booking_date": {"$gte": start, "$lt": next_start}}, {"_id": 0}
    ).to_list(500)
    for b in bookings:
        lid = b.get("lead_id")
        items.append({
            "id": f"booking-{b['id']}",
            "kind": "booking",
            "activity_subtype": b.get("meeting_status") or "scheduled",
            "at": b["booking_date"],
            "entity_id": b["id"],
            "lead_id": lid,
            "contact_label": f"Lead {str(lid)[:8]}…" if lid else "Booking",
            "platform": b.get("source") or b.get("booking_source") or "—",
            "status": b.get("meeting_status") or "—",
            "summary": str(b.get("notes") or "")[:160],
            "detail_route": "/bookings",
        })

    tasks = await db.tasks.find(
        {"due_date": {"$gte": start, "$lt": next_start}}, {"_id": 0}
    ).to_list(500)
    for t in tasks:
        title = str(t.get("title") or "Task")
        desc = str(t.get("description") or "")
        lid = t.get("lead_id")
        items.append({
            "id": f"task-{t['id']}",
            "kind": "task",
            "activity_subtype": t.get("task_type") or "task",
            "at": t["due_date"],
            "entity_id": t["id"],
            "lead_id": lid,
            "contact_label": title,
            "platform": t.get("channel") or "—",
            "status": "Completed" if t.get("completed") else "Open",
            "summary": (desc or title)[:160],
            "detail_route": f"/leads/{lid}" if lid else "/tasks",
        })

    lead_ids = list({i["lead_id"] for i in items if i.get("lead_id")})
    lead_map = {}
    if lead_ids:
        cursor = db.leads.find({"id": {"$in": lead_ids}}, {"_id": 0, "id": 1, "company_name": 1, "contact_name": 1})
        async for row in cursor:
            lead_map[row["id"]] = row

    for it in items:
        lid = it.get("lead_id")
        if not lid or lid not in lead_map:
            continue
        if it["kind"] not in ("booking", "call", "task"):
            continue
        L = lead_map[lid]
        cl = " · ".join(x for x in [L.get("company_name"), L.get("contact_name")] if x)
        if not cl:
            continue
        if it["kind"] == "task":
            task_title = it["contact_label"]
            it["summary"] = " — ".join(x for x in [task_title, it["summary"]] if x)[:160]
        it["contact_label"] = cl

    items.sort(key=lambda x: _ts(x.get("at")))
    return {"date": date, "items": items}


# ==================== METRICS/DASHBOARD ROUTES ====================

@api_router.get("/dashboard/metrics")
async def get_dashboard_metrics(request: Request):
    await get_current_user(request)
    
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    today_iso = today.isoformat()
    
    # Optimized: Get all lead metrics in single aggregation pipeline
    lead_pipeline = [
        {
            "$facet": {
                "total": [{"$count": "count"}],
                "new_today": [{"$match": {"created_at": {"$gte": today_iso}}}, {"$count": "count"}],
                "by_status": [{"$group": {"_id": "$status", "count": {"$sum": 1}}}],
                "by_platform": [{"$group": {"_id": "$source_platform", "count": {"$sum": 1}}}]
            }
        }
    ]
    lead_results = await db.leads.aggregate(lead_pipeline).to_list(1)
    lead_data = lead_results[0] if lead_results else {}
    
    total_leads = lead_data.get("total", [{}])[0].get("count", 0)
    new_leads_today = lead_data.get("new_today", [{}])[0].get("count", 0) if lead_data.get("new_today") else 0
    
    # Parse status counts
    status_counts = {}
    statuses = ["New Lead", "Contacted", "Replied", "Interested", "Qualified", "Booked", "No Response", "Not Interested", "Closed Won", "Closed Lost"]
    for status in statuses:
        status_counts[status] = 0
    for item in lead_data.get("by_status", []):
        if item["_id"] in status_counts:
            status_counts[item["_id"]] = item["count"]
    
    # Parse platform breakdown
    platform_counts = {item["_id"]: item["count"] for item in lead_data.get("by_platform", [])}
    instagram_leads = platform_counts.get("Instagram", 0)
    facebook_leads = platform_counts.get("Facebook Groups", 0)
    
    # Optimized: Get all call metrics in single aggregation
    call_pipeline = [
        {
            "$facet": {
                "total": [{"$count": "count"}],
                "qualified": [{"$match": {"qualified": True}}, {"$count": "count"}],
                "booked": [{"$match": {"booked": True}}, {"$count": "count"}]
            }
        }
    ]
    call_results = await db.calls.aggregate(call_pipeline).to_list(1)
    call_data = call_results[0] if call_results else {}
    
    total_calls = call_data.get("total", [{}])[0].get("count", 0) if call_data.get("total") else 0
    qualified_calls = call_data.get("qualified", [{}])[0].get("count", 0) if call_data.get("qualified") else 0
    booked_calls = call_data.get("booked", [{}])[0].get("count", 0) if call_data.get("booked") else 0
    
    # Tasks - keep as separate queries (only 2 queries with different complex conditions)
    overdue_tasks = await db.tasks.count_documents({"due_date": {"$lt": today_iso}, "completed": False})
    tasks_today = await db.tasks.count_documents({
        "due_date": {"$gte": today_iso, "$lt": (today + timedelta(days=1)).isoformat()},
        "completed": False
    })
    
    # Optimized: Get booking metrics in single aggregation
    booking_pipeline = [
        {
            "$facet": {
                "scheduled": [{"$match": {"meeting_status": "scheduled"}}, {"$count": "count"}],
                "completed": [{"$match": {"meeting_status": "completed"}}, {"$count": "count"}]
            }
        }
    ]
    booking_results = await db.bookings.aggregate(booking_pipeline).to_list(1)
    booking_data = booking_results[0] if booking_results else {}
    
    scheduled_bookings = booking_data.get("scheduled", [{}])[0].get("count", 0) if booking_data.get("scheduled") else 0
    completed_bookings = booking_data.get("completed", [{}])[0].get("count", 0) if booking_data.get("completed") else 0
    
    # Calculate conversion rates
    contacted = status_counts.get("Contacted", 0) + status_counts.get("Replied", 0) + status_counts.get("Interested", 0) + status_counts.get("Qualified", 0) + status_counts.get("Booked", 0) + status_counts.get("Closed Won", 0)
    replied = status_counts.get("Replied", 0) + status_counts.get("Interested", 0) + status_counts.get("Qualified", 0) + status_counts.get("Booked", 0) + status_counts.get("Closed Won", 0)
    interested = status_counts.get("Interested", 0) + status_counts.get("Qualified", 0) + status_counts.get("Booked", 0) + status_counts.get("Closed Won", 0)
    booked = status_counts.get("Booked", 0) + status_counts.get("Closed Won", 0)
    closed_won = status_counts.get("Closed Won", 0)
    
    return {
        "leads": {
            "total": total_leads,
            "new_today": new_leads_today,
            "contacted": contacted,
            "replied": replied,
            "interested": interested,
            "qualified": status_counts.get("Qualified", 0),
            "booked": booked,
            "closed_won": closed_won,
            "closed_lost": status_counts.get("Closed Lost", 0),
            "no_response": status_counts.get("No Response", 0)
        },
        "status_counts": status_counts,
        "platform_breakdown": {
            "instagram": instagram_leads,
            "facebook_groups": facebook_leads
        },
        "calls": {
            "total": total_calls,
            "qualified": qualified_calls,
            "booked": booked_calls
        },
        "tasks": {
            "overdue": overdue_tasks,
            "due_today": tasks_today
        },
        "bookings": {
            "scheduled": scheduled_bookings,
            "completed": completed_bookings
        },
        "conversion_rates": {
            "contacted_to_replied": round((replied / contacted * 100) if contacted > 0 else 0, 1),
            "replied_to_interested": round((interested / replied * 100) if replied > 0 else 0, 1),
            "interested_to_booked": round((booked / interested * 100) if interested > 0 else 0, 1),
            "booked_to_closed": round((closed_won / booked * 100) if booked > 0 else 0, 1)
        }
    }

# ==================== SETTINGS ROUTES ====================

@api_router.get("/settings/statuses")
async def get_statuses(request: Request):
    await get_current_user(request)
    settings = await db.settings.find_one({"type": "lead_statuses"}, {"_id": 0})
    if not settings:
        return {"statuses": ["New Lead", "Contacted", "Replied", "Interested", "Qualified", "Booked", "No Response", "Not Interested", "Closed Won", "Closed Lost"]}
    return settings

@api_router.put("/settings/statuses")
async def update_statuses(data: dict, request: Request):
    user = await get_current_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    await db.settings.update_one(
        {"type": "lead_statuses"},
        {"$set": {"statuses": data.get("statuses", []), "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True
    )
    return {"message": "Statuses updated", "statuses": data.get("statuses", [])}

@api_router.get("/users")
async def get_users(request: Request):
    user = await get_current_user(request)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(100)
    for u in users:
        if "id" not in u:
            u["id"] = u.get("email", "")
    return {"users": users}

# Health check endpoint (no auth required)
@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "villapel-os-api"}

# Include the router
app.include_router(api_router)

# CORS Middleware
cors_origins = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
if frontend_url not in cors_origins:
    cors_origins.append(frontend_url)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in cors_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==================== STARTUP / SEED ====================

@app.on_event("startup")
async def startup_event():
    # Create indexes
    await db.users.create_index("email", unique=True)
    await db.leads.create_index("id", unique=True)
    await db.leads.create_index("phone")
    await db.leads.create_index("instagram_handle")
    await db.leads.create_index("status")
    await db.login_attempts.create_index("identifier")
    
    # API Keys and Integration Logs indexes
    await db.api_keys.create_index("key", unique=True)
    await db.api_keys.create_index("id", unique=True)
    await db.integration_logs.create_index("created_at")
    await db.integration_logs.create_index([("created_at", -1)])
    
    # Seed admin user
    await seed_admin()
    
    # Seed demo data (skip in production with SKIP_SEED=true)
    if os.environ.get("SKIP_SEED", "false").lower() != "true":
        await seed_demo_data()
    
    # Write test credentials
    await write_test_credentials()
    
    logger.info("Villapel OS API started successfully")

async def seed_admin():
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@villapel.com")
    admin_password = os.environ.get("ADMIN_PASSWORD", "VillapelAdmin2024!")
    
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        hashed = hash_password(admin_password)
        await db.users.insert_one({
            "email": admin_email,
            "password_hash": hashed,
            "name": "Admin",
            "role": "admin",
            "created_at": datetime.now(timezone.utc)
        })
        logger.info(f"Admin user created: {admin_email}")
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"password_hash": hash_password(admin_password)}}
        )
        logger.info(f"Admin password updated: {admin_email}")

async def write_test_credentials():
    # Skip writing test credentials in production
    logger.info("Admin credentials configured via environment variables")

async def seed_demo_data():
    # Check if data already exists
    lead_count = await db.leads.count_documents({})
    if lead_count > 0:
        logger.info("Demo data already exists, skipping seed")
        return
    
    # US cities and states for roofing companies
    locations = [
        ("Houston", "TX"), ("Dallas", "TX"), ("Austin", "TX"), ("San Antonio", "TX"), ("Fort Worth", "TX"),
        ("Phoenix", "AZ"), ("Tucson", "AZ"), ("Mesa", "AZ"), ("Scottsdale", "AZ"),
        ("Denver", "CO"), ("Colorado Springs", "CO"), ("Aurora", "CO"),
        ("Atlanta", "GA"), ("Savannah", "GA"), ("Augusta", "GA"),
        ("Tampa", "FL"), ("Miami", "FL"), ("Orlando", "FL"), ("Jacksonville", "FL"),
        ("Charlotte", "NC"), ("Raleigh", "NC"), ("Durham", "NC"),
        ("Nashville", "TN"), ("Memphis", "TN"), ("Knoxville", "TN"),
        ("Oklahoma City", "OK"), ("Tulsa", "OK"),
        ("Kansas City", "MO"), ("St. Louis", "MO"),
        ("Indianapolis", "IN"), ("Fort Wayne", "IN"),
        ("Columbus", "OH"), ("Cleveland", "OH"), ("Cincinnati", "OH"),
        ("Birmingham", "AL"), ("Montgomery", "AL"),
        ("New Orleans", "LA"), ("Baton Rouge", "LA"),
        ("Las Vegas", "NV"), ("Henderson", "NV"),
        ("Salt Lake City", "UT"), ("Provo", "UT"),
        ("Albuquerque", "NM"), ("Santa Fe", "NM"),
        ("Omaha", "NE"), ("Lincoln", "NE"),
        ("Wichita", "KS"), ("Overland Park", "KS")
    ]
    
    roofing_names = [
        "Elite", "Premier", "Summit", "Peak", "Crown", "Royal", "Apex", "Legacy", "Heritage", "Titan",
        "Precision", "Quality", "American", "National", "Superior", "Pro", "Expert", "Master", "Reliable", "Trusted",
        "First Choice", "Top Notch", "All Star", "Five Star", "Golden", "Silver", "Diamond", "Platinum", "Eagle", "Hawk"
    ]
    
    roofing_suffixes = ["Roofing", "Roofing Co", "Roofing Solutions", "Roof Pros", "Roofing & Restoration", "Roofing Services", "Roofing Experts"]
    
    statuses = ["New Lead", "Contacted", "Replied", "Interested", "Qualified", "Booked", "No Response", "Not Interested", "Closed Won", "Closed Lost"]
    status_weights = [15, 12, 10, 8, 6, 5, 20, 8, 10, 6]
    
    import random
    
    # Generate 60 leads
    leads = []
    for i in range(60):
        city, state = random.choice(locations)
        company = f"{random.choice(roofing_names)} {random.choice(roofing_suffixes)}"
        first_names = ["John", "Mike", "David", "James", "Robert", "William", "Chris", "Tom", "Steve", "Dan", "Mark", "Paul", "Joe", "Brian", "Kevin", "Jason", "Matt", "Eric", "Jeff", "Tim"]
        last_names = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Martinez", "Anderson", "Wilson", "Moore", "Taylor", "Thomas", "Jackson", "White", "Harris", "Martin", "Thompson", "Robinson"]
        contact = f"{random.choice(first_names)} {random.choice(last_names)}"
        
        phone = f"({random.randint(200, 999)}) {random.randint(200, 999)}-{random.randint(1000, 9999)}"
        
        status = random.choices(statuses, weights=status_weights, k=1)[0]
        platform = random.choice(["Instagram", "Facebook Groups"])
        priority = random.choice(["low", "medium", "high"])
        
        days_ago = random.randint(0, 60)
        created_at = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
        
        lead = {
            "id": str(uuid.uuid4()),
            "company_name": company,
            "contact_name": contact,
            "phone": phone,
            "email": f"{contact.lower().replace(' ', '.')}@{company.lower().replace(' ', '').replace('&', '')[:15]}.com",
            "city": city,
            "state": state,
            "website": f"https://www.{company.lower().replace(' ', '').replace('&', '')}roofing.com",
            "instagram_handle": f"@{company.lower().replace(' ', '_')[:20]}" if platform == "Instagram" else None,
            "facebook_page": f"{company}" if platform == "Facebook Groups" else None,
            "source_platform": platform,
            "source_detail": f"{'DM outreach' if platform == 'Instagram' else 'Group: Roofing Contractors USA'}",
            "status": status,
            "priority": priority,
            "notes": None,
            "notes_history": [],
            "first_contact_date": created_at if status != "New Lead" else None,
            "last_contact_date": created_at if status not in ["New Lead"] else None,
            "next_action_date": (datetime.now(timezone.utc) + timedelta(days=random.randint(1, 7))).isoformat() if status in ["Contacted", "Replied", "Interested"] else None,
            "assigned_to": "Admin",
            "created_at": created_at,
            "updated_at": created_at
        }
        leads.append(lead)
    
    await db.leads.insert_many(leads)
    logger.info(f"Seeded {len(leads)} demo leads")
    
    # Seed Instagram outreach records
    ig_records = []
    ig_leads = [l for l in leads if l["source_platform"] == "Instagram"][:20]
    for lead in ig_leads:
        ig_records.append({
            "id": str(uuid.uuid4()),
            "lead_id": lead["id"],
            "account_used": "@villapel_agency",
            "date_contacted": lead["created_at"],
            "follow_status": random.choice(["followed", "not_followed", "followed_back"]),
            "liked_posts_count": random.randint(0, 5),
            "first_dm_sent": "Hey! Love your roofing work. Are you using AI to handle your calls?" if lead["status"] != "New Lead" else None,
            "last_reply": "Thanks! Tell me more about what you offer" if lead["status"] in ["Replied", "Interested", "Qualified", "Booked", "Closed Won"] else None,
            "conversation_status": "replied" if lead["status"] in ["Replied", "Interested", "Qualified", "Booked", "Closed Won"] else "dm_sent" if lead["status"] == "Contacted" else "not_started",
            "notes": None,
            "timeline": [{"action": "created", "date": lead["created_at"], "details": "Outreach record created"}],
            "created_at": lead["created_at"],
            "updated_at": lead["created_at"]
        })
    await db.outreach_instagram.insert_many(ig_records)
    logger.info(f"Seeded {len(ig_records)} Instagram outreach records")
    
    # Seed Facebook Groups outreach records
    fb_groups = [
        "Roofing Contractors USA", "Storm Restoration Pros", "Roofing Business Growth", 
        "Home Service Contractors Network", "Roofing Sales Mastermind", "Contractor Marketing Tips",
        "Roofing Leads & Sales", "Home Improvement Pros", "Storm Chasers Network"
    ]
    fb_records = []
    for _ in range(25):
        group = random.choice(fb_groups)
        lead_captured = random.random() > 0.6
        linked_lead = random.choice([l for l in leads if l["source_platform"] == "Facebook Groups"]) if lead_captured else None
        
        days_ago = random.randint(0, 30)
        created_at = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
        
        fb_records.append({
            "id": str(uuid.uuid4()),
            "lead_id": linked_lead["id"] if linked_lead else None,
            "group_name": group,
            "post_link": f"https://facebook.com/groups/{group.lower().replace(' ', '')}/posts/{random.randint(1000000, 9999999)}",
            "post_type": random.choice(["engagement", "value_post", "comment", "reply"]),
            "comment_made": "Great question! AI receptionists are game-changers for roofing companies. Happy to share what we've learned." if random.random() > 0.5 else None,
            "people_engaged": [f"User{i}" for i in random.sample(range(1, 50), random.randint(0, 5))],
            "person_followed_up": linked_lead["contact_name"] if linked_lead else None,
            "follow_up_method": random.choice(["DM", "Comment reply", "Friend request"]) if linked_lead else None,
            "lead_captured": lead_captured,
            "notes": None,
            "timeline": [{"action": "created", "date": created_at, "details": "Facebook group outreach record created"}],
            "created_at": created_at,
            "updated_at": created_at
        })
    await db.outreach_facebook_groups.insert_many(fb_records)
    logger.info(f"Seeded {len(fb_records)} Facebook group outreach records")
    
    # Seed message templates
    templates = [
        {"name": "First Contact - Instagram", "category": "first_contact", "platform": "Instagram", "content": "Hey {contact_name}! I came across {company_name} and love what you're doing in {city}. Quick question - are you currently using any AI or automation to handle your incoming calls and leads?", "variables": ["contact_name", "company_name", "city"]},
        {"name": "First Contact - FB Group", "category": "first_contact", "platform": "Facebook Groups", "content": "Hi {contact_name}, saw your post in the group and it resonated. We help roofing companies like yours capture more leads with AI receptionists. Would love to share how it works if you're interested!", "variables": ["contact_name"]},
        {"name": "Follow-up - No Response", "category": "follow_up", "platform": "Instagram", "content": "Hey {contact_name}, just circling back on my last message. Would love to show you how our AI receptionist can help {company_name} never miss another lead. Got 5 minutes this week?", "variables": ["contact_name", "company_name"]},
        {"name": "Follow-up - Interested", "category": "interested_lead", "platform": "Instagram", "content": "Awesome to hear you're interested, {contact_name}! Here's a quick link to book a demo: [CALENDAR_LINK]. Looking forward to showing you how this can work for {company_name}.", "variables": ["contact_name", "company_name"]},
        {"name": "Booked - Confirmation", "category": "booked_lead", "platform": "Instagram", "content": "Perfect, {contact_name}! Just confirming our call on [DATE]. I'll be showing you exactly how our AI receptionist can help {company_name} capture and qualify more roofing leads 24/7. Talk soon!", "variables": ["contact_name", "company_name"]},
        {"name": "Reactivation", "category": "reactivation", "platform": "Instagram", "content": "Hey {contact_name}! It's been a while since we chatted. We've added some cool new features to our AI receptionist that I think would be perfect for {company_name}. Want to take another look?", "variables": ["contact_name", "company_name"]},
        {"name": "FB Group Comment", "category": "first_contact", "platform": "Facebook Groups", "content": "Great question! We've helped dozens of roofing companies solve this exact problem with AI. Happy to share what's been working - shoot me a DM if you'd like the details.", "variables": []},
        {"name": "FB Group Reply", "category": "follow_up", "platform": "Facebook Groups", "content": "Thanks for reaching out! For {company_name}, I'd recommend starting with our AI receptionist that handles calls 24/7. Want me to send over a quick video demo?", "variables": ["company_name"]}
    ]
    for t in templates:
        t["id"] = str(uuid.uuid4())
        t["created_at"] = datetime.now(timezone.utc).isoformat()
        t["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.message_templates.insert_many(templates)
    logger.info(f"Seeded {len(templates)} message templates")
    
    # Seed calls
    calls = []
    call_leads = random.sample(leads, 15)
    for lead in call_leads:
        days_ago = random.randint(0, 30)
        call_date = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()
        outcome = random.choice(["answered", "voicemail", "no_answer", "callback_requested", "booked"])
        
        calls.append({
            "id": str(uuid.uuid4()),
            "lead_id": lead["id"],
            "caller_phone": lead["phone"],
            "company_name": lead["company_name"],
            "call_date": call_date,
            "duration_seconds": random.randint(30, 900) if outcome in ["answered", "booked"] else 0,
            "outcome": outcome,
            "qualified": outcome in ["answered", "booked"] and random.random() > 0.3,
            "booked": outcome == "booked",
            "transcript_summary": f"Discussed AI receptionist services for {lead['company_name']}. {'Interested in demo.' if outcome in ['answered', 'booked'] else 'Left voicemail.'}" if outcome != "no_answer" else None,
            "recording_url": None,
            "score": random.choice(["bad", "average", "good"]),
            "created_at": call_date
        })
    await db.calls.insert_many(calls)
    logger.info(f"Seeded {len(calls)} calls")
    
    # Seed tasks
    task_types = ["send_follow_up", "call_lead", "review_reply", "post_in_group", "reply_in_group", "check_booked_demo"]
    tasks = []
    for i in range(20):
        lead = random.choice(leads)
        due_offset = random.randint(-3, 7)
        due_date = (datetime.now(timezone.utc) + timedelta(days=due_offset)).isoformat()
        task_type = random.choice(task_types)
        
        tasks.append({
            "id": str(uuid.uuid4()),
            "lead_id": lead["id"],
            "task_type": task_type,
            "title": f"{task_type.replace('_', ' ').title()} - {lead['company_name']}",
            "description": f"Follow up with {lead['contact_name']} at {lead['company_name']}",
            "due_date": due_date,
            "assigned_to": "Admin",
            "priority": random.choice(["low", "medium", "high"]),
            "completed": due_offset < -1 and random.random() > 0.5,
            "created_by": "Admin",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        })
    await db.tasks.insert_many(tasks)
    logger.info(f"Seeded {len(tasks)} tasks")
    
    # Seed bookings
    booked_leads = [l for l in leads if l["status"] in ["Booked", "Closed Won", "Closed Lost"]]
    bookings = []
    for lead in booked_leads[:10]:
        days_offset = random.randint(-10, 10)
        booking_date = (datetime.now(timezone.utc) + timedelta(days=days_offset)).isoformat()
        meeting_status = "completed" if days_offset < 0 else "scheduled"
        if lead["status"] == "Closed Won":
            meeting_status = "completed"
            outcome = "closed_won"
        elif lead["status"] == "Closed Lost":
            meeting_status = "completed"
            outcome = "closed_lost"
        else:
            outcome = None
        
        bookings.append({
            "id": str(uuid.uuid4()),
            "lead_id": lead["id"],
            "booking_date": booking_date,
            "source": lead["source_platform"],
            "meeting_status": meeting_status,
            "outcome": outcome,
            "notes": f"Demo call with {lead['contact_name']}",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        })
    await db.bookings.insert_many(bookings)
    logger.info(f"Seeded {len(bookings)} bookings")
    
    # Seed automations
    automations = [
        {"id": str(uuid.uuid4()), "name": "Make", "description": "Workflow automation platform", "status": "planned", "webhook_url": None, "icon": "Zap"},
        {"id": str(uuid.uuid4()), "name": "Google Sheets", "description": "Spreadsheet sync for lead data", "status": "planned", "webhook_url": None, "icon": "Table"},
        {"id": str(uuid.uuid4()), "name": "Gmail", "description": "Email automation and sequences", "status": "planned", "webhook_url": None, "icon": "Mail"},
        {"id": str(uuid.uuid4()), "name": "Google Calendar", "description": "Booking and scheduling sync", "status": "planned", "webhook_url": None, "icon": "Calendar"},
        {"id": str(uuid.uuid4()), "name": "Cal.com", "description": "Scheduling automation", "status": "planned", "webhook_url": None, "icon": "CalendarCheck"},
        {"id": str(uuid.uuid4()), "name": "Twilio", "description": "SMS and calling integration", "status": "planned", "webhook_url": None, "icon": "Phone"},
        {"id": str(uuid.uuid4()), "name": "Retell AI", "description": "AI voice agent for calls", "status": "planned", "webhook_url": None, "icon": "Headphones"},
        {"id": str(uuid.uuid4()), "name": "OpenAI", "description": "AI-powered features", "status": "planned", "webhook_url": None, "icon": "Brain"}
    ]
    await db.automations.insert_many(automations)
    logger.info(f"Seeded {len(automations)} automations")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
