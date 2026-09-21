# AI SOP Generator - Swimlane Diagram

## Mermaid Swimlane Diagram

```mermaid
sequenceDiagram
    participant Admin as Admin<br/>(Process Owner)
    participant Employee as Employee<br/>(End User)
    participant Frontend as SOP Web App<br/>(Frontend)
    participant Backend as Backend / AI & DB

    Note over Admin: Admin Setup Phase
    Admin->>Backend: A1: Define/update departments & roles
    Admin->>Backend: A2: Create SOP templates<br/>(Sales, Service, Parts, etc.)
    Admin->>Backend: A3: Add SOP blocks<br/>(step type, conditions, EN/AR text, role)
    Admin->>Backend: A4: Publish new version<br/>of SOP template

    Note over Employee,Backend: SOP Generation Phase
    Employee->>Frontend: E1: Open SOP Generator
    Frontend->>Employee: F1: Display SOP Generator form<br/>(department, role, scenario, filters, language)
    
    Employee->>Frontend: E2: Select department, role, scenario<br/>(e.g., "Sales Advisor – Lease – Government employee – Bank A")
    Employee->>Frontend: E3: Enter filters<br/>(bank, customer type, car model, location, language)
    Employee->>Frontend: E4: Click "Generate SOP"
    
    Frontend->>Backend: F2: POST /api/sop/generate<br/>(department, role, scenario, filters, language)
    Frontend->>Employee: F3: Show loading state
    
    Backend->>Backend: B1: Receive generate request
    Backend->>Backend: B2: Query DB for relevant<br/>SopTemplates and SopBlocks<br/>(based on department, role, scenario, filters)
    Backend->>Backend: B3: Build RAG prompt<br/>(scenario, filters, SOP blocks as knowledge)
    Backend->>Backend: B4: Call OpenAI API
    Backend->>Backend: B5: Parse AI JSON result<br/>(title, steps, required documents, warnings, customer script)
    Backend->>Backend: B6: Create SopSession and<br/>SopSessionSteps records in DB
    Backend->>Frontend: B7: Return structured SOP JSON<br/>(title, steps, docs, warnings, script)
    
    Frontend->>Employee: F4: Display SOP<br/>(title, steps, docs, warnings, script)
    Employee->>Employee: E5: Review generated SOP<br/>(steps, required documents, warnings, customer script)

    Note over Employee,Backend: SOP Execution Phase
    Employee->>Frontend: E6: Start SOP session<br/>and follow checklist
    Frontend->>Backend: F5: Create/open SOP session view<br/>with interactive checklist
    
    Employee->>Frontend: E7: Mark steps as done/in progress
    Frontend->>Backend: F6: PATCH /api/sop/sessions/[id]/steps/[stepId]<br/>(update status)
    Backend->>Backend: B8: Update SopSessionSteps.status<br/>and completedAt
    
    Employee->>Frontend: E8: Export SOP as PDF
    Frontend->>Backend: F7: Trigger PDF export<br/>(call PDF endpoint or client-side PDF builder)
    Frontend->>Employee: F7: Return PDF file
    
    Note over Employee,Backend: Feedback Phase
    Employee->>Frontend: E9: Submit feedback<br/>(if SOP is wrong or incomplete)
    Frontend->>Backend: F8: POST /api/sop/feedback<br/>(feedback form data)
    Backend->>Backend: B9: Create SopFeedback entry
    Backend->>Frontend: B9: Confirm feedback received
    Frontend->>Employee: F8: Show feedback confirmation
```

## Alternative: Structured Text Layout for draw.io

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ADMIN (Process Owner)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ A1: Define/update departments & roles                                       │
│     │                                                                        │
│     ▼                                                                        │
│ A2: Create SOP templates (Sales, Service, Parts, etc.)                      │
│     │                                                                        │
│     ▼                                                                        │
│ A3: Add SOP blocks (step type, conditions, EN/AR text, role)                 │
│     │                                                                        │
│     ▼                                                                        │
│ A4: Publish new version of SOP template                                      │
│     │                                                                        │
│     └───────────────────────────────────────────────────────────────────────┘
│
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EMPLOYEE (End User)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ E1: Open SOP Generator                                                       │
│     │                                                                        │
│     ▼                                                                        │
│ E2: Select department, role, scenario                                        │
│     (e.g., "Sales Advisor – Lease – Government employee – Bank A")          │
│     │                                                                        │
│     ▼                                                                        │
│ E3: Enter filters (bank, customer type, car model, location, language)      │
│     │                                                                        │
│     ▼                                                                        │
│ E4: Click "Generate SOP"                                                     │
│     │                                                                        │
│     ▼                                                                        │
│ E5: Review generated SOP (steps, required documents, warnings, script)       │
│     │                                                                        │
│     ▼                                                                        │
│ E6: Start SOP session and follow checklist                                  │
│     │                                                                        │
│     ▼                                                                        │
│ E7: Mark steps as done/in progress                                          │
│     │                                                                        │
│     ▼                                                                        │
│ E8: Export SOP as PDF                                                        │
│     │                                                                        │
│     ▼                                                                        │
│ E9: Submit feedback if SOP is wrong or incomplete                            │
│
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SOP WEB APP (Frontend)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│ F1: Display SOP Generator form                                               │
│     (department, role, scenario, filters, language)                          │
│     │                                                                        │
│     ▼                                                                        │
│ F2: Send generate request to /api/sop/generate with all inputs              │
│     │                                                                        │
│     ▼                                                                        │
│ F3: Show loading state                                                       │
│     │                                                                        │
│     ▼                                                                        │
│ F4: Display SOP returned by backend                                         │
│     (title, steps, docs, warnings, script)                                   │
│     │                                                                        │
│     ▼                                                                        │
│ F5: Create or open SOP session view with interactive checklist               │
│     │                                                                        │
│     ▼                                                                        │
│ F6: On checkbox toggle, call /api/sop/sessions/[id]/steps/[stepId]          │
│     to update status                                                         │
│     │                                                                        │
│     ▼                                                                        │
│ F7: Trigger PDF export (call PDF endpoint or client-side PDF builder)      │
│     │                                                                        │
│     ▼                                                                        │
│ F8: Send feedback form data to /api/sop/feedback                             │
│
┌─────────────────────────────────────────────────────────────────────────────┐
│                        BACKEND / AI & DB                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ B1: Receive generate request                                                │
│     │                                                                        │
│     ▼                                                                        │
│ B2: Query DB for relevant SopTemplates and SopBlocks                         │
│     (based on department, role, scenario, filters)                           │
│     │                                                                        │
│     ▼                                                                        │
│ B3: Build RAG prompt with scenario, filters and SOP blocks as knowledge      │
│     │                                                                        │
│     ▼                                                                        │
│ B4: Call OpenAI API                                                          │
│     │                                                                        │
│     ▼                                                                        │
│ B5: Parse AI JSON result                                                     │
│     (title, steps, required documents, warnings, customer script)           │
│     │                                                                        │
│     ▼                                                                        │
│ B6: Create SopSession and SopSessionSteps records in the database            │
│     │                                                                        │
│     ▼                                                                        │
│ B7: Return structured SOP JSON to frontend                                   │
│     │                                                                        │
│     ▼                                                                        │
│ B8: Receive checklist update requests → update SopSessionSteps.status       │
│     and completedAt                                                          │
│     │                                                                        │
│     ▼                                                                        │
│ B9: Receive feedback → create SopFeedback entry                              │
```

## Flow Connections Between Lanes

### Admin → Backend
- A1, A2, A3, A4 all connect to Backend (database operations)

### Employee → Frontend
- E1-E9 all interact with Frontend UI

### Frontend ↔ Backend
- F2 → B1 (Generate request)
- B7 → F4 (SOP response)
- F6 → B8 (Checklist updates)
- F8 → B9 (Feedback submission)

### Key Decision Points
- After E5: Employee reviews → decides to proceed (E6) or provide feedback (E9)
- After B5: AI parsing success → proceed to B6, or handle error
- After F4: Display success → proceed to F5, or show error message

