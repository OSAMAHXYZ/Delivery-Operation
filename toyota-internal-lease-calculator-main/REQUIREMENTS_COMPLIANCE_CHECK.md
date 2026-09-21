# Toyota Showroom Queue System - Requirements Compliance Check

## ✅ IMPLEMENTED FEATURES

### 1. Promoter Page
- ✅ 4 action buttons: Auto Assign, Guest Experience, Phone Call, Second Visit
- ✅ Name + Phone inputs for all actions
- ✅ Advisor dropdown for Second Visit
- ✅ Round-robin assignment algorithm
- ✅ Global waiting list when all advisors busy
- ✅ Auto-pull from waiting list when advisor becomes available
- ✅ Real-time advisor status display
- ✅ Waiting/Active counts per advisor
- ✅ Assigned Today count per advisor

### 2. Sales Advisor Page
- ✅ FIFO restriction (only oldest customer can be accepted)
- ✅ View of waiting list
- ✅ Accept/Complete functionality
- ✅ Status updates

### 3. Admin Page
- ✅ Guest Experience KPI display
- ✅ 5-minute escalation detection
- ✅ Timeout alerts display
- ✅ Report generation (Excel export)
- ✅ Live employee status

### 4. Backend
- ✅ Round-robin assignment
- ✅ Auto-extract from waiting list
- ✅ WebSocket real-time updates
- ✅ Saudi Arabia time (UTC+3)
- ✅ Daily count tracking

## ❌ MISSING/INCOMPLETE FEATURES

### 1. Data Model Issues
- ❌ Using `customerType` instead of `sourceType` (should be: WALK_IN, PHONE_CALL, GUEST_EXPERIENCE, SECOND_VISIT)
- ❌ Status values are lowercase (waiting, accepted) instead of uppercase (WAITING, ASSIGNED, ACTIVE, DONE, ADMIN_HANDLED)
- ❌ Missing `ticketId` field (using `id` instead)
- ❌ Missing `waitExceeded5Min` boolean flag on tickets
- ❌ Missing `handledByAdmin` boolean flag
- ❌ Missing `adminHandledAt` timestamp
- ❌ Missing `adminHandledBy` field
- ❌ Missing `activeCustomerId` on advisor model
- ❌ Using `dailyCustomersCount` instead of `assignedTodayCount`

### 2. Promoter Page Missing
- ❌ Real-time waiting count at top (global waiting list count)
- ❌ Real-time active count at top (customers currently being served)
- ❌ Table format showing all advisors with: name/id, status, assignedTodayCount

### 3. Assignment Logic Issues
- ❌ SECOND_VISIT tickets should go to advisor's PERSONAL QUEUE, not global waiting list
- ❌ When advisor becomes available, should check PERSONAL QUEUE first, then global waiting list
- ❌ Missing proper priority logic: personal queue (SECOND_VISIT) → global waiting (WALK_IN/PHONE_CALL)

### 4. Sales Advisor Page Missing
- ❌ Clear separation between PERSONAL QUEUE and GLOBAL WAITING LIST views
- ❌ Status toggle buttons (AVAILABLE/BUSY/OUT_OF_OFFICE)
- ❌ Display of current ACTIVE customer
- ❌ Visual distinction between personal queue tickets and global waiting tickets

### 5. Admin Page Missing
- ❌ "Admin Handle" button functionality
- ❌ AdminHandledToday KPI counter
- ❌ Proper report export with all required fields:
  - name, phone, sourceType, createdAt, assignedAdvisorId, assignedAt, acceptedAt, status
  - handledByAdmin (true/false)
  - adminHandledAt
  - waitExceeded5Min (true/false)
  - tag (PHONE_CALL indicator)
- ❌ "Escalated Waiting" panel showing customers waiting >5 min with name + phone + waiting time + type

### 6. Status Flow Issues
- ❌ Tickets should have status: WAITING → ASSIGNED → ACTIVE → DONE
- ❌ Currently using: waiting → accepted → completed
- ❌ Missing ASSIGNED status (when auto-assigned but not yet accepted)
- ❌ Missing ADMIN_HANDLED status

### 7. Auto-Assign Logic
- ❌ Should set status=ASSIGNED when auto-assigned (not WAITING)
- ❌ Should only set status=WAITING when in global waiting list
- ❌ Should increment assignedTodayCount when status becomes ASSIGNED

## 🔧 REQUIRED FIXES

### Priority 1: Data Model Standardization
1. Rename `customerType` → `sourceType` with values: WALK_IN, PHONE_CALL, GUEST_EXPERIENCE, SECOND_VISIT
2. Standardize status values: WAITING, ASSIGNED, ACTIVE, DONE, ADMIN_HANDLED
3. Add missing fields: waitExceeded5Min, handledByAdmin, adminHandledAt, adminHandledBy
4. Add activeCustomerId to advisor model
5. Rename dailyCustomersCount → assignedTodayCount

### Priority 2: Personal Queue Implementation
1. Create separate personal queue for each advisor (SECOND_VISIT tickets)
2. Update auto-pull logic to check personal queue first
3. Update SECOND_VISIT assignment to go to personal queue if advisor busy

### Priority 3: Promoter Page Enhancements
1. Add real-time waiting/active counts at top
2. Add advisor status table format
3. Show assignedTodayCount in table

### Priority 4: Sales Advisor Page Enhancements
1. Add status toggle buttons
2. Separate personal queue vs global waiting list views
3. Show current active customer
4. Visual badges for ticket types

### Priority 5: Admin Handle Functionality
1. Add "Admin Handle" button to escalated customers
2. Implement admin handle endpoint
3. Update ticket status to ADMIN_HANDLED
4. Add AdminHandledToday KPI
5. Update report export with all fields

### Priority 6: Report Export Enhancement
1. Include all required columns
2. Mark ADMIN_HANDLED tickets clearly
3. Include waitExceeded5Min flag
4. Include tag field for PHONE_CALL

## 📊 COMPLIANCE SCORE

- **Overall Compliance: ~65%**
- **Core Functionality: 80%** ✅
- **Data Model: 40%** ❌
- **UI Requirements: 60%** ⚠️
- **Admin Features: 70%** ⚠️
- **FIFO Rules: 90%** ✅
- **Realtime: 100%** ✅

## 🎯 NEXT STEPS

1. Refactor data model to match specification exactly
2. Implement personal queue system
3. Add missing UI elements
4. Complete admin handle functionality
5. Enhance report export

