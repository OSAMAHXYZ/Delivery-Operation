# Lead Distribution System - Implementation Summary

## Overview
A Flutter desktop application (macOS/Windows) that processes car dealership leads from CRM exports and distributes them to sales agents following complex business rules.

## 10-Step Business Process

### Steps 1-4: Data Preprocessing (Handled by ExcelRepository)
1. ✅ **Download raw data from CRM** - User uploads CSV file
2. ✅ **Split assigned column** - Separate "Sales Assigned" into date and time fields
3. ✅ **Format dates** - Convert format from "11.05.2025" to "11-05-2025"
4. ✅ **Unify model names** - Standardize car model names (e.g., "CAMRY 2.5L" → "CAMRY")

### Steps 5-10: Lead Distribution (Handled by LeadDistributionService)
5. ✅ **Filter by product** - Process only valid vehicle models
6. ✅ **Distribute evenly** - Round-robin distribution per product
7. ✅ **CAMRY/LC300/LC70** → Sales Advisors ONLY
8. ✅ **COASTER/HIACE/LITEACE** → Wasim Awad (ID: 22323) ONLY
9. ✅ **Fleet type leads** → Wasim Awad (ID: 22323) ONLY
10. 🔜 **Surplus leads** → Call Agents (infrastructure ready, not yet implemented)

## Technical Architecture

### Clean Architecture Layers
```
lib/
├── domain/          # Business logic & entities
│   ├── models/      # Lead, Agent, Assignment, Category
│   ├── services/    # LeadDistributionService
│   └── utils/       # ModelUnifier
├── data/            # Data sources & repositories
│   └── repositories/# ExcelRepository (CSV/Excel parsing)
└── presentation/    # UI layer
    ├── pages/       # AdminPage
    ├── providers/   # Riverpod state management
    └── widgets/     # TreeView, SummaryTable, AgentManagement
```

### Key Components

#### 1. Lead Model (`lib/domain/models/lead.dart`)
- Fields: customer name, mobile, model, leadType (retail/fleet), assigned date/time
- Supports fleet detection via `LeadType.fleet` enum

#### 2. Agent Model (`lib/domain/models/agent.dart`)
- Two types: Sales Advisors vs Call Agents
- Status: Active, Sick, Out of Office
- Special agent: Wasim Awad (ID: 22323)

#### 3. ModelUnifier (`lib/domain/utils/model_unifier.dart`)
- Standardizes car model names
- Business rules:
  - `isSalesAdvisorOnly()`: CAMRY, LC300, LC70
  - `isWasimAwadOnly()`: COASTER, HIACE BUS, HIACE VAN, LITEACE

#### 4. ExcelRepository (`lib/data/repositories/excel_repository.dart`)
- UTF-16 encoding support (LE/BE with BOM detection)
- Processes tab-delimited CSV files
- Implements steps 2-4 (date split, format, unification)

#### 5. LeadDistributionService (`lib/domain/services/lead_distribution_service.dart`)
- Implements steps 5-10
- Special handling for:
  - Fleet leads → Wasim Awad
  - COASTER/HIACE/LITEACE → Wasim Awad
  - CAMRY/LC300/LC70 → Sales Advisors only
  - General leads → Round-robin to Sales Advisors

## Default Agents

### Sales Advisors
- Wasim Awad (22323) - **Special agent for COASTER/HIACE/LITEACE/Fleet**
- Sales Advisor 1 (SA_01)
- Sales Advisor 2 (SA_02)
- Sales Advisor 3 (SA_03)

### Call Agents (for future surplus handling)
- Call Agent 1 (CA_01)
- Call Agent 2 (CA_02)
- Call Agent 3 (CA_03)

## Data Format

### Input CSV Format
- Encoding: UTF-16 LE (with BOM)
- Delimiter: Tab (`\t`)
- Required columns:
  - Customer Name
  - Mobile Number
  - Model
  - Lead Type (retail/fleet)
  - Sales Assigned (date + time combined)

### Example Row
```
Customer Name	Mobile Number	Model	Lead Type	Sales Assigned
John Doe	+971501234567	CAMRY 2.5L	retail	11.05.2025 14:30
```

### Output After Processing
- Lead Type: `LeadType.retail` or `LeadType.fleet`
- Model: `CAMRY` (unified)
- Assigned Date: `11-05-2025`
- Assigned Time: `14:30`

## UI Features

### Agent Management
- Separate sections for Sales Advisors and Call Agents
- Toggle agent status (Active/OOO)
- Rebalance button to redistribute leads when agents change

### Tree View
- Hierarchical display: Category → Agent → Leads
- Shows lead count per agent per model

### Summary Table
- Matrix view: Agents (rows) × Models (columns)
- Total leads per agent
- Visual status indicators (green = active, grey = unavailable)

### Export Functions
- Export Assignments: Full lead details with agent assignments
- Export Summary: Aggregated counts by agent and model

## macOS Permissions
File access permissions configured in:
- `macos/Runner/DebugProfile.entitlements`
- `macos/Runner/Release.entitlements`

Required permission: `com.apple.security.files.user-selected.read-write`

## Testing

### Sample Data
- File: `/Users/jason/Downloads/leadfilter/leadfilter/sample_leads.csv`
- Contains: 215 leads
- Encoding: UTF-16 LE
- Format: Tab-delimited

### Test Scenarios
1. Upload sample CSV → Verify encoding is handled correctly
2. Check CAMRY leads → Should only go to Sales Advisors
3. Check COASTER/HIACE/LITEACE → Should only go to Wasim Awad (22323)
4. Check Fleet leads → Should only go to Wasim Awad (22323)
5. Toggle Wasim to OOO → Should throw error (required agent)
6. Rebalance → Should redistribute based on active agents

## Known Limitations

1. **Step 10 (Surplus to Call Agents)**: Infrastructure is ready, but capacity limits not yet implemented
2. **Agent Addition**: UI supports adding agents, but no persistence (resets on app restart)
3. **Validation**: Limited input validation for CSV format errors

## Future Enhancements

1. Implement capacity limits for Step 10 (surplus distribution)
2. Add database persistence for agent configurations
3. Add CSV validation and error reporting
4. Support for bulk agent import
5. Historical reporting and analytics
6. Dark mode support

## Running the Application

```bash
# Development (macOS)
flutter run -d macos

# Production build
flutter build macos --release

# Run on Windows
flutter run -d windows
```

## Dependencies
- flutter_riverpod: 2.6.1 (state management)
- file_picker: 8.3.7 (file selection)
- csv: 6.0.0 (CSV parsing)
- excel: 4.0.6 (Excel export)
- equatable: 2.0.7 (value equality)
- path_provider: 2.1.5 (file paths)

## Architecture Principles
- SOLID principles
- Clean Architecture
- Separation of Concerns
- Single Responsibility
- Dependency Inversion
