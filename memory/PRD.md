# Villapel OS - Product Requirements Document

## Overview
**App Name:** Villapel OS  
**Tagline:** AI-powered lead system for roofing businesses  
**Version:** 1.1.0 (MVP + Make.com Integration)  
**Last Updated:** March 30, 2026

## User Personas
- **Admin User:** Agency owner managing all aspects of lead generation
- **Team Member:** (Future) Sales rep handling outreach and follow-ups

## Core Requirements (Static)

### Business Context
- Agency sells AI receptionist services, websites, and automations to roofing companies in the U.S.
- Main offer: AI receptionist that answers calls, qualifies leads, and helps book estimates
- Outreach channels: Instagram (direct outreach) and Facebook Groups (community-based)

### Technical Stack
- Frontend: React 19 + Tailwind CSS + Shadcn/UI
- Backend: FastAPI + Python
- Database: MongoDB
- Authentication: JWT with httpOnly cookies + API Key auth for external services

## What's Been Implemented ✅

### Phase 1: MVP (March 30, 2026)

#### Authentication System
- [x] JWT-based login/logout
- [x] Admin account seeding (admin@villapel.com)
- [x] Protected routes with auth context
- [x] Brute force protection

#### Dashboard
- [x] KPI cards (Total Leads, Replied, Booked Demos, Closed Won)
- [x] Secondary metrics (Calls Made, Tasks Overdue, Platform breakdown)
- [x] Lead Status Distribution chart
- [x] Platform Breakdown pie chart
- [x] Conversion Rates panel
- [x] Quick action links

#### CRM / Lead Management
- [x] Leads table with 60+ demo records
- [x] Search and filter (status, platform, priority)
- [x] Lead detail page with full profile
- [x] Status change dropdown (10 color-coded statuses)
- [x] Add/edit/delete leads
- [x] Notes system with history
- [x] Duplicate prevention (phone, Instagram handle)

#### Outreach Manager
- [x] Instagram Outreach tab
- [x] Facebook Groups Outreach tab

#### Message Templates
- [x] Template library with categories
- [x] Platform-specific templates
- [x] Copy to clipboard functionality

#### Calls Module
- [x] Call logs
- [x] Outcome filtering and scoring
- [x] Placeholder for Retell AI integration

#### Tasks / Follow-up System
- [x] Task categories (overdue, today, upcoming, completed)
- [x] Task types and priorities
- [x] Mark complete/pending toggle

#### Booking Tracker
- [x] Demo bookings management
- [x] Meeting status and outcome tracking

#### Automations Module
- [x] Integration cards for planned services

#### Settings / Admin
- [x] User profile display
- [x] Lead status configuration

### Phase 2: Make.com API Integration (March 30, 2026)

#### API Key Authentication System
- [x] MongoDB `api_keys` collection
- [x] X-API-Key header validation middleware
- [x] Permission-based access (leads:write, tasks:write, bookings:write, calls:write)
- [x] Create API key endpoint (returns key ONCE)
- [x] List API keys endpoint (masked)
- [x] Revoke API key endpoint
- [x] Last used tracking

#### External API Endpoints (/api/external/*)
- [x] POST /api/external/leads/intake
  - Lead deduplication cascade (phone → instagram → facebook)
  - Merge/update existing leads with new non-empty fields
  - Notes appended with timestamps (never replaced)
  - Tags merged and deduplicated
- [x] PATCH /api/external/leads/update
  - Find by lead_id, phone, or instagram_handle
  - Update status, notes, dates, tags
- [x] POST /api/external/tasks/create
  - Create tasks linked to leads
  - Auto-generated flag for system tasks
- [x] POST /api/external/bookings/create-or-update
  - Create or update bookings
  - Auto-update lead status to "Booked"
  - Add booking note to lead
- [x] POST /api/external/calls/log
  - Log calls with Retell AI support
  - Auto-match leads by phone
  - Update lead status based on outcomes

#### Integration Logs
- [x] MongoDB `integration_logs` collection
- [x] Log all external API calls
- [x] Store: timestamp, endpoint, source, success/failure, response code, summary
- [x] Keep last 500 logs

#### Frontend Integrations Page
- [x] API Keys management (create, view masked, revoke)
- [x] New key display with security warning
- [x] Webhook Endpoints reference with copy buttons
- [x] Integration Logs table with refresh

## Prioritized Backlog

### P0 (Critical - Next Sprint)
- [ ] Password reset functionality
- [ ] User registration flow
- [ ] Team member invite system

### P1 (Important)
- [ ] Retell AI integration (AI voice calls)
- [ ] Make.com webhook integration
- [ ] Google Calendar sync
- [ ] Email sequence automation (Gmail)
- [ ] Real-time notifications

### P2 (Nice to Have)
- [ ] Cal.com integration
- [ ] Twilio SMS integration
- [ ] OpenAI-powered features
- [ ] Advanced reporting/analytics
- [ ] Export to Google Sheets
- [ ] Mobile app (PWA)

### P3 (Future)
- [ ] Multi-tenant support
- [ ] White-label options
- [ ] Advanced CRM features (deals, pipelines)
- [ ] AI lead scoring
- [ ] Predictive analytics

## Database Schema

### Collections
- `users` - User accounts
- `leads` - CRM leads
- `outreach_instagram` - Instagram outreach records
- `outreach_facebook_groups` - Facebook group outreach records
- `message_templates` - Message templates
- `calls` - Call logs
- `tasks` - Tasks/follow-ups
- `bookings` - Scheduled demos
- `automations` - Integration configurations
- `settings` - System settings
- `login_attempts` - Brute force protection

## API Endpoints

### Auth
- POST /api/auth/login
- POST /api/auth/register
- POST /api/auth/logout
- GET /api/auth/me
- POST /api/auth/refresh

### Leads
- GET/POST /api/leads
- GET/PUT/DELETE /api/leads/{id}
- POST /api/leads/{id}/notes

### Outreach
- GET/POST /api/outreach/instagram
- PUT /api/outreach/instagram/{id}
- GET/POST /api/outreach/facebook-groups
- PUT /api/outreach/facebook-groups/{id}

### Other
- GET/POST/PUT/DELETE /api/templates
- GET/POST/PUT /api/calls
- GET/POST/PUT/DELETE /api/tasks
- GET/POST/PUT /api/bookings
- GET/PUT /api/automations
- GET /api/dashboard/metrics
- GET/PUT /api/settings/statuses
- GET /api/users

## Test Credentials
- Admin: admin@villapel.com / VillapelAdmin2024!
