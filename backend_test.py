import requests
import sys
import json
from datetime import datetime

class VillapelOSAPITester:
    def __init__(self, base_url="https://villapel-os.preview.emergentagent.com"):
        self.base_url = base_url
        self.token = None
        self.cookies = {}
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.base_url}/api/{endpoint}"
        test_headers = {'Content-Type': 'application/json'}
        
        if headers:
            test_headers.update(headers)
        
        if self.token:
            test_headers['Authorization'] = f'Bearer {self.token}'

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=test_headers, cookies=self.cookies)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=test_headers, cookies=self.cookies)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=test_headers, cookies=self.cookies)
            elif method == 'DELETE':
                response = requests.delete(url, headers=test_headers, cookies=self.cookies)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                
                # Store cookies for session management
                if response.cookies:
                    self.cookies.update(response.cookies)
                
                try:
                    return success, response.json() if response.text else {}
                except:
                    return success, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                print(f"   Response: {response.text[:200]}...")
                self.failed_tests.append({
                    'name': name,
                    'expected': expected_status,
                    'actual': response.status_code,
                    'response': response.text[:200]
                })
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.failed_tests.append({
                'name': name,
                'error': str(e)
            })
            return False, {}

    def test_auth_login(self):
        """Test admin login"""
        print("\n🔐 Testing Authentication...")
        success, response = self.run_test(
            "Admin Login",
            "POST",
            "auth/login",
            200,
            data={"email": "admin@villapel.com", "password": "VillapelAdmin2024!"}
        )
        if success and 'id' in response:
            print(f"   Logged in as: {response.get('name')} ({response.get('role')})")
            return True
        return False

    def test_auth_me(self):
        """Test get current user"""
        success, response = self.run_test(
            "Get Current User",
            "GET",
            "auth/me",
            200
        )
        return success and 'email' in response

    def test_dashboard_metrics(self):
        """Test dashboard metrics"""
        print("\n📊 Testing Dashboard...")
        success, response = self.run_test(
            "Dashboard Metrics",
            "GET",
            "dashboard/metrics",
            200
        )
        if success:
            leads = response.get('leads', {})
            print(f"   Total leads: {leads.get('total', 0)}")
            print(f"   New today: {leads.get('new_today', 0)}")
            print(f"   Replied: {leads.get('replied', 0)}")
        return success

    def test_leads_crud(self):
        """Test leads CRUD operations"""
        print("\n👥 Testing Leads...")
        
        # Get leads
        success, response = self.run_test(
            "Get Leads",
            "GET",
            "leads",
            200
        )
        if not success:
            return False
        
        leads_count = len(response.get('leads', []))
        total_count = response.get('total', 0)
        print(f"   Found {leads_count} leads (total: {total_count})")
        
        # Test lead creation with unique phone
        timestamp = datetime.now().strftime("%H%M%S")
        new_lead_data = {
            "company_name": "Test Roofing Co",
            "contact_name": "John Test",
            "phone": f"(555) 123-{timestamp}",
            "email": f"john{timestamp}@testroofing.com",
            "city": "Test City",
            "state": "TX",
            "source_platform": "Instagram",
            "priority": "medium"
        }
        
        success, response = self.run_test(
            "Create Lead",
            "POST",
            "leads",
            200,
            data=new_lead_data
        )
        
        if success and 'id' in response:
            lead_id = response['id']
            print(f"   Created lead with ID: {lead_id}")
            
            # Test get specific lead
            success, _ = self.run_test(
                "Get Specific Lead",
                "GET",
                f"leads/{lead_id}",
                200
            )
            
            # Test update lead
            if success:
                success, _ = self.run_test(
                    "Update Lead Status",
                    "PUT",
                    f"leads/{lead_id}",
                    200,
                    data={"status": "Contacted"}
                )
            
            return success
        
        return False

    def test_outreach_instagram(self):
        """Test Instagram outreach"""
        print("\n📱 Testing Instagram Outreach...")
        
        # Get Instagram records
        success, response = self.run_test(
            "Get Instagram Outreach",
            "GET",
            "outreach/instagram",
            200
        )
        
        if success:
            records_count = len(response.get('records', []))
            print(f"   Found {records_count} Instagram records")
        
        return success

    def test_outreach_facebook(self):
        """Test Facebook Groups outreach"""
        print("\n📘 Testing Facebook Groups Outreach...")
        
        success, response = self.run_test(
            "Get Facebook Groups Outreach",
            "GET",
            "outreach/facebook-groups",
            200
        )
        
        if success:
            records_count = len(response.get('records', []))
            print(f"   Found {records_count} Facebook group records")
        
        return success

    def test_templates(self):
        """Test message templates"""
        print("\n📝 Testing Message Templates...")
        
        success, response = self.run_test(
            "Get Templates",
            "GET",
            "templates",
            200
        )
        
        if success:
            templates_count = len(response.get('templates', []))
            print(f"   Found {templates_count} templates")
        
        return success

    def test_calls(self):
        """Test calls"""
        print("\n📞 Testing Calls...")
        
        success, response = self.run_test(
            "Get Calls",
            "GET",
            "calls",
            200
        )
        
        if success:
            calls_count = len(response.get('calls', []))
            print(f"   Found {calls_count} calls")
        
        return success

    def test_tasks(self):
        """Test tasks"""
        print("\n✅ Testing Tasks...")
        
        success, response = self.run_test(
            "Get Tasks",
            "GET",
            "tasks",
            200
        )
        
        if success:
            tasks_count = len(response.get('tasks', []))
            print(f"   Found {tasks_count} tasks")
        
        return success

    def test_bookings(self):
        """Test bookings"""
        print("\n📅 Testing Bookings...")
        
        success, response = self.run_test(
            "Get Bookings",
            "GET",
            "bookings",
            200
        )
        
        if success:
            bookings_count = len(response.get('bookings', []))
            print(f"   Found {bookings_count} bookings")
        
        return success

    def test_automations(self):
        """Test automations"""
        print("\n🤖 Testing Automations...")
        
        success, response = self.run_test(
            "Get Automations",
            "GET",
            "automations",
            200
        )
        
        if success:
            automations_count = len(response.get('automations', []))
            print(f"   Found {automations_count} automations")
        
        return success

    def test_settings(self):
        """Test settings"""
        print("\n⚙️ Testing Settings...")
        
        # Test get statuses
        success, response = self.run_test(
            "Get Lead Statuses",
            "GET",
            "settings/statuses",
            200
        )
        
        if success:
            statuses = response.get('statuses', [])
            print(f"   Found {len(statuses)} lead statuses")
        
        return success

    def test_api_keys_management(self):
        """Test API Keys management"""
        print("\n🔑 Testing API Keys Management...")
        
        # Get existing API keys
        success, response = self.run_test(
            "Get API Keys",
            "GET",
            "api-keys",
            200
        )
        if not success:
            return False
        
        existing_keys = response.get('api_keys', [])
        print(f"   Found {len(existing_keys)} existing API keys")
        
        # Create new API key
        new_key_data = {
            "name": "Test Make.com Key",
            "permissions": ["leads:write", "tasks:write", "bookings:write", "calls:write"]
        }
        
        success, response = self.run_test(
            "Create API Key",
            "POST",
            "api-keys",
            200,
            data=new_key_data
        )
        
        if success and 'key' in response:
            api_key = response['key']
            key_id = response['id']
            print(f"   Created API key: {api_key[:10]}...")
            
            # Don't revoke yet - we need it for external API tests
            return success, api_key, key_id
        
        return False, None, None

    def revoke_api_key(self, key_id):
        """Revoke an API key"""
        success, _ = self.run_test(
            "Revoke API Key",
            "DELETE",
            f"api-keys/{key_id}",
            200
        )
        return success

    def test_integration_logs(self):
        """Test integration logs"""
        print("\n📋 Testing Integration Logs...")
        
        success, response = self.run_test(
            "Get Integration Logs",
            "GET",
            "integration-logs",
            200
        )
        
        if success:
            logs_count = len(response.get('logs', []))
            print(f"   Found {logs_count} integration logs")
        
        return success

    def test_external_leads_intake(self, api_key):
        """Test external leads intake API"""
        print("\n🔗 Testing External Leads Intake...")
        
        # Test without API key (should fail)
        success, _ = self.run_test(
            "Leads Intake - No API Key",
            "POST",
            "external/leads/intake",
            401,
            data={
                "source": "clawbot",
                "channel": "instagram",
                "company_name": "Test External Company",
                "contact_name": "Jane External",
                "phone": "(555) 999-8888",
                "instagram_handle": "testexternal"
            }
        )
        
        if not success:
            print("   ❌ Should have failed without API key")
            return False
        
        # Test with API key
        headers = {"X-API-Key": api_key}
        success, response = self.run_test(
            "Leads Intake - With API Key",
            "POST",
            "external/leads/intake",
            201,
            data={
                "source": "clawbot",
                "channel": "instagram", 
                "company_name": "Test External Company",
                "contact_name": "Jane External",
                "phone": "(555) 999-8888",
                "instagram_handle": "testexternal",
                "notes": "Test lead from external API",
                "tags": ["test", "external"]
            },
            headers=headers
        )
        
        if success and response.get('action') == 'created':
            lead_id = response.get('lead_id')
            print(f"   Created lead via external API: {lead_id}")
            
            # Test deduplication - same phone should update
            success, response = self.run_test(
                "Leads Intake - Deduplication Test",
                "POST",
                "external/leads/intake",
                201,  # API returns 201 for both create and update
                data={
                    "source": "clawbot",
                    "channel": "instagram",
                    "company_name": "Test External Company Updated",
                    "phone": "(555) 999-8888",  # Same phone
                    "notes": "Updated via deduplication",
                    "tags": ["updated", "dedup"]
                },
                headers=headers
            )
            
            if success and response.get('action') == 'updated':
                print(f"   ✅ Deduplication working - matched on: {response.get('matched_on')}")
                return True, lead_id
            else:
                print(f"   ❌ Deduplication failed - action: {response.get('action')}")
                return False, None
        
        return False, None

    def test_external_leads_update(self, api_key, lead_id):
        """Test external leads update API"""
        print("\n🔄 Testing External Leads Update...")
        
        headers = {"X-API-Key": api_key}
        success, response = self.run_test(
            "Leads Update - External API",
            "PATCH",
            "external/leads/update",
            200,
            data={
                "lead_id": lead_id,
                "updates": {
                    "status": "Contacted",
                    "notes": "Updated via external API",
                    "tags": ["contacted", "external-update"]
                }
            },
            headers=headers
        )
        
        if success:
            updated_fields = response.get('updated_fields', [])
            print(f"   Updated fields: {', '.join(updated_fields)}")
        
        return success

    def test_external_tasks_create(self, api_key, lead_id):
        """Test external tasks create API"""
        print("\n📋 Testing External Tasks Create...")
        
        headers = {"X-API-Key": api_key}
        success, response = self.run_test(
            "Tasks Create - External API",
            "POST",
            "external/tasks/create",
            201,
            data={
                "lead_id": lead_id,
                "task_type": "send_followup",
                "title": "Follow up with external lead",
                "description": "Created via external API",
                "priority": "high",
                "channel": "instagram"
            },
            headers=headers
        )
        
        if success:
            task_id = response.get('task_id')
            print(f"   Created task via external API: {task_id}")
        
        return success

    def test_external_bookings_create(self, api_key, lead_id):
        """Test external bookings create API"""
        print("\n📅 Testing External Bookings Create...")
        
        headers = {"X-API-Key": api_key}
        booking_date = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        
        success, response = self.run_test(
            "Bookings Create - External API",
            "POST",
            "external/bookings/create-or-update",
            201,
            data={
                "lead_id": lead_id,
                "booking_source": "calcom",
                "booking_date": booking_date,
                "booking_type": "demo",
                "status": "scheduled",
                "notes": "Created via external API"
            },
            headers=headers
        )
        
        if success:
            booking_id = response.get('booking_id')
            action = response.get('action')
            print(f"   {action.title()} booking via external API: {booking_id}")
        
        return success

    def test_external_calls_log(self, api_key):
        """Test external calls log API"""
        print("\n📞 Testing External Calls Log...")
        
        headers = {"X-API-Key": api_key}
        call_date = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        
        success, response = self.run_test(
            "Calls Log - External API",
            "POST",
            "external/calls/log",
            201,
            data={
                "phone": "(555) 999-8888",  # Should match our test lead
                "direction": "inbound",
                "call_date": call_date,
                "duration_seconds": 180,
                "qualified": True,
                "transcript_summary": "Customer interested in roofing services",
                "notes": "Logged via external API"
            },
            headers=headers
        )
        
        if success:
            call_id = response.get('call_id')
            matched_lead_id = response.get('matched_lead_id')
            print(f"   Logged call via external API: {call_id}")
            if matched_lead_id:
                print(f"   ✅ Call linked to lead: {matched_lead_id}")
        
        return success

    def test_auth_logout(self):
        """Test logout"""
        success, _ = self.run_test(
            "Logout",
            "POST",
            "auth/logout",
            200
        )
        if success:
            self.cookies = {}  # Clear cookies
        return success

def main():
    print("🚀 Starting Villapel OS API Tests")
    print("=" * 50)
    
    tester = VillapelOSAPITester()
    
    # Test sequence
    basic_tests = [
        ("Authentication", tester.test_auth_login),
        ("Current User", tester.test_auth_me),
        ("Dashboard Metrics", tester.test_dashboard_metrics),
        ("Leads CRUD", tester.test_leads_crud),
        ("Instagram Outreach", tester.test_outreach_instagram),
        ("Facebook Outreach", tester.test_outreach_facebook),
        ("Message Templates", tester.test_templates),
        ("Calls", tester.test_calls),
        ("Tasks", tester.test_tasks),
        ("Bookings", tester.test_bookings),
        ("Automations", tester.test_automations),
        ("Settings", tester.test_settings)
    ]
    
    failed_categories = []
    api_key = None
    test_lead_id = None
    
    # Run basic tests first
    for test_name, test_func in basic_tests:
        try:
            if not test_func():
                failed_categories.append(test_name)
        except Exception as e:
            print(f"❌ {test_name} failed with exception: {e}")
            failed_categories.append(test_name)
    
    # Test API Keys and External APIs
    try:
        success, api_key, key_id = tester.test_api_keys_management()
        if not success:
            failed_categories.append("API Keys Management")
        else:
            # Test integration logs
            if not tester.test_integration_logs():
                failed_categories.append("Integration Logs")
            
            # Test external APIs with the created API key
            if api_key:
                # Test external leads intake
                success, test_lead_id = tester.test_external_leads_intake(api_key)
                if not success:
                    failed_categories.append("External Leads Intake")
                
                # Test external leads update
                if test_lead_id and not tester.test_external_leads_update(api_key, test_lead_id):
                    failed_categories.append("External Leads Update")
                
                # Test external tasks create
                if test_lead_id and not tester.test_external_tasks_create(api_key, test_lead_id):
                    failed_categories.append("External Tasks Create")
                
                # Test external bookings create
                if test_lead_id and not tester.test_external_bookings_create(api_key, test_lead_id):
                    failed_categories.append("External Bookings Create")
                
                # Test external calls log
                if not tester.test_external_calls_log(api_key):
                    failed_categories.append("External Calls Log")
                
                # Now revoke the API key
                if key_id and not tester.revoke_api_key(key_id):
                    failed_categories.append("API Key Revocation")
    
    except Exception as e:
        print(f"❌ External API tests failed with exception: {e}")
        failed_categories.extend(["API Keys Management", "External APIs"])
    
    # Test logout
    try:
        if not tester.test_auth_logout():
            failed_categories.append("Logout")
    except Exception as e:
        print(f"❌ Logout failed with exception: {e}")
        failed_categories.append("Logout")
    
    # Print results
    print("\n" + "=" * 50)
    print("📊 TEST RESULTS")
    print("=" * 50)
    print(f"Tests passed: {tester.tests_passed}/{tester.tests_run}")
    print(f"Success rate: {(tester.tests_passed/tester.tests_run*100):.1f}%" if tester.tests_run > 0 else "0%")
    
    if failed_categories:
        print(f"\n❌ Failed categories: {', '.join(failed_categories)}")
    
    if tester.failed_tests:
        print(f"\n🔍 Failed test details:")
        for test in tester.failed_tests:
            error_msg = test.get('error', f"Expected {test.get('expected')}, got {test.get('actual')}")
            print(f"   - {test['name']}: {error_msg}")
    
    return 0 if tester.tests_passed == tester.tests_run else 1

if __name__ == "__main__":
    sys.exit(main())