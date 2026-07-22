# IGMP Back Office — Agent Interactions Breakdown for IT Team

## What is IGMP?
**IGMP** = Integrated Gaming Management Platform (WS1/WS2 kiosk + CMS stack)
- **Hosts:** best-in-asia.com (WS1 V3 per-country back offices) + WS2 back office
- **Purpose:** Manages player promotions (bonuses, free credits, free spins)
- **Scope for Agent:** Automates promo code creation and activation across IGMP platforms

---

## What the Agent Does (High Level)
1. **Reads** promotion requirements from a spreadsheet
2. **Creates** promotion records (deposit bonuses, free credits, free spins) in IGMP BO
3. **Updates** promotion details (date changes, status changes)
4. **Activates** promotions (final publish step)
5. **Validates** that changes were saved correctly

---

## IGMP API Endpoints the Agent Touches

### **Create Promotions (POST requests)**
| Endpoint | What It Does | Used For |
|----------|-------------|----------|
| `POST /PM/AddBonus` | Creates a deposit bonus | "Get 100% bonus on your first deposit" |
| `POST /PM/AddFreeCredit` | Creates free credit promo | "Get $10 free play" |
| `POST /PM/AddFreeSpin` | Creates free spins promo | "Get 50 free spins on slots" |

### **Read Promotion Details (GET requests)**
| Endpoint | What It Returns |
|----------|-----------------|
| `GET /PM/GetPromotionsList` | List of all promotions (codes, names, status) |
| `GET /PM/GetBonusInfo?code=XXX` | Full details of a specific bonus (dates, amounts, T&Cs) |
| `GET /PM/GetFreeCreditInfo?code=XXX` | Full details of a specific free credit offer |

### **Update Promotions (PUT/POST requests)**
| Endpoint | What It Does | Critical Note |
|----------|-------------|---|
| `POST /PM/UpdateBonusDetails` | Edit an existing bonus | **WS1 ONLY** |
| `POST /PM/UpdateFreeCreditDetails` | Edit an existing free credit | **WS1 ONLY** |
| `POST /PM/UpdatePromotionStatus` | Activate/Deactivate a promo | Final step after creation |

---

## Data Flow: From Agent to IGMP BO

```
Spreadsheet (P### request)
    ↓
Agent reads and validates
    ↓
Agent calls POST /PM/AddBonus (or FC/FS)
    ↓
IGMP BO creates promotion record
    ↓
Agent calls POST /PM/UpdatePromotionStatus
    ↓
IGMP BO activates promotion (goes live)
    ↓
Agent calls GET /PM/GetBonusInfo to verify
    ↓
Agent reports success/failure
```

---

## Key Data the Agent Sends to IGMP

When creating a promotion, the agent includes:
- **Code**: Unique identifier (e.g., `TEST_100MATCH`)
- **Name**: Human-readable description (e.g., "100% First Deposit Match")
- **Bonus Amount**: Cash or percentage (e.g., 100 SGD or 50%)
- **Turnover Requirement**: How much player must bet (e.g., 3x bonus)
- **Valid Date Range**: Start and end dates
- **Game Categories**: Which games can be used (slots, live casino, etc.)
- **Status**: Active (1) or Inactive (0)

---

## Critical Behaviors to Know

### **WS1-Only Restriction**
- **Update operations** (UpdateBonusDetails, UpdateFreeCreditDetails) only work on WS1
- WS2 and QPRO use different mechanisms
- Agent checks platform type before attempting updates

### **Activation Workflow**
```
Step 1: Create promo (status = inactive/draft)
    ↓
Step 2: Update details if needed (edits applied)
    ↓
Step 3: Call UpdatePromotionStatus (status = active/live)
    ↓
Never go backwards — deactivation is a separate flow
```

### **Authentication**
- Agent uses session cookies from logged-in BO user
- Cookies expire → agent needs re-authentication
- If cookie is stale, API calls return **500 errors**

---

## What MCP Needs to Handle

### **1. API Communication**
- **HTTP methods**: POST (create/update), GET (read)
- **Authentication**: Cookie-based session management
- **Error handling**: Distinguish between stale auth vs. business logic errors
- **Rate limiting**: Batch creates can spike requests (hundreds of promos at once)

### **2. Data Validation**
- Ensure all required fields are present before sending
- Validate date formats (DD-MM-YYYY expected by IGMP)
- Verify numeric values (amounts, turn-over requirements) are in valid ranges
- Check that game category IDs match IGMP's internal catalog

### **3. State Management**
- Track which promos were created vs. already exist
- Know which ones are activated vs. still in draft
- Handle partial failures (3 of 5 promos created, 2 failed)
- Support idempotency (running same request twice = same result, no duplicates)

### **4. Audit Trail**
- Log all API calls (request payload + response)
- Capture timestamps for each promotion's creation/update
- Store which agent instance made which changes
- Support rollback if needed

### **5. Session/Auth Management**
- Detect and refresh expired cookies
- Handle multi-region logins (IGMP has per-country back offices)
- Support fallback if one region's BO is down

---

## Example Request/Response

### **Create a Deposit Bonus**
```
POST /PM/AddBonus
Host: best-in-asia.com
Cookie: [session token]

Body:
{
  "promo_code": "TEST_100MATCH",
  "promotion_name": "100% First Deposit Match",
  "bonus_amount": 100,
  "currency": "SGD",
  "turnover_requirement": 3,
  "valid_from": "01-06-2026",
  "valid_to": "30-06-2026",
  "game_categories": [1, 3, 5],  // Slots, Live Casino, Table Games
  "status": 0  // Draft (inactive)
}

Response (Success):
{
  "success": true,
  "promo_id": 12345,
  "message": "Promotion created successfully"
}

Response (Failure):
{
  "success": false,
  "error": "Promo code already exists",
  "error_code": 1001
}
```

---

## Integration Complexity: Low to Medium

| Area | Complexity | Notes |
|------|-----------|-------|
| Basic CRUD | 🟢 Low | Standard REST API calls |
| Auth/Cookies | 🟡 Medium | Session management, expiry handling |
| Data Validation | 🟡 Medium | Multiple rules per field, cascading checks |
| Error Recovery | 🟡 Medium | Partial failures, retry logic |
| Multi-Region | 🟡 Medium | 6+ per-country BO instances, different cookies |
| Audit Logging | 🟢 Low | Standard request/response logging |

---

## What to Prepare for MCP Integration

1. **API Schema Definition**
   - Document all endpoints (POST, GET, parameters)
   - Define request/response payloads as JSON schemas
   - List all error codes and what they mean

2. **Authentication Module**
   - MCP tool to handle session login/refresh
   - Cookie storage and validation
   - Timeout detection and re-auth triggering

3. **Core Operations as Separate Tools**
   - `create_bonus()` — POST /PM/AddBonus
   - `create_free_credit()` — POST /PM/AddFreeCredit
   - `create_free_spin()` — POST /PM/AddFreeSpin
   - `update_promo_status()` — POST /PM/UpdatePromotionStatus
   - `get_promo_details()` — GET /PM/GetBonusInfo
   - `list_promos()` — GET /PM/GetPromotionsList

4. **Validation & Mapping Layer**
   - Map spreadsheet column names → IGMP field names
   - Validate amounts, dates, game category IDs
   - Convert currency codes (SGD, IDR, MYR) → IGMP currency IDs (1, 3, 4)

5. **Error Handling & Logging**
   - Capture HTTP status codes
   - Log request bodies and responses
   - Track which agent call failed and why
   - Support dry-run mode (validation without actual API calls)

6. **Testing Endpoints**
   - IGMP test BO environment (if available)
   - Fixtures with known test promo codes
   - Mock responses for unit testing

---

## Questions to Ask IGMP Platform Team

1. Is there a staging/test IGMP BO we can develop against?
2. What's the session timeout? How often do cookies expire?
3. Are there rate limits per IP or per user session?
4. Do you have API documentation for the `/PM/*` endpoints?
5. Are there any upcoming changes to the BO API we should know about?
6. Can we get read-only API keys instead of session-based auth?
7. Do you have an API versioning strategy?

