# Lead Tracking System - Data Requirements

## Overview
The Lead Tracking page (`tracking.html`) allows you to analyze and track lead performance after distribution. It provides comprehensive analytics including status breakdowns, call performance, and employee statistics.

## Required Excel/CSV Columns

### Required Columns (Minimum)
These columns are essential for the tracking system to work:

1. **Assigned To / AssignedEmployeeID**
   - **Purpose**: Identifies which employee is responsible for the lead
   - **Example values**: "EE0001", "EE0002", "22323"
   - **Alternative names**: "Assigned To", "AssignedEmployeeID", "Assigned_To", "Employee ID", "Employee_ID", "Assigned Employee"

2. **Status**
   - **Purpose**: Current status of the lead
   - **Example values**: "Open", "Submit", "Closed", "Converted", "Rejected"
   - **Alternative names**: "Status", "status", "STATUS", "Lead Status", "Lead_Status", "lead_status"
   - **Note**: "Open" and "Submit" statuses are automatically identified as "Pending Leads"

3. **Call Status / Call Result**
   - **Purpose**: Result of the call attempt
   - **Example values**: "Successful", "Answered", "Connected", "Failed", "No Answer", "No Response", "Rejected", "Not Interested"
   - **Alternative names**: "Call Status", "Call_Status", "Call Result", "Call_Result", "CallResult", "Call Outcome", "Outcome"
   - **Note**: The system recognizes:
     - **Successful**: Contains "SUCCESS", "ANSWERED", or "CONNECTED"
     - **Failed**: Contains "FAIL", "REJECTED", or "NOT INTERESTED"
     - **No Answer**: Contains "NO ANSWER", "NO RESPONSE", or "MISSED"

### Recommended Columns
These columns enhance the tracking experience but are optional:

4. **Name / Prospect Name**
   - **Purpose**: Customer name for identification
   - **Alternative names**: "Name", "name", "Prospect", "prospect", "Customer Name", "Customer_Name", "Prospect Name"

5. **Contact / Phone / Telephone**
   - **Purpose**: Customer contact number
   - **Alternative names**: "Contact", "contact", "Phone", "phone", "Telephone", "telephone", "Mobile", "mobile"

6. **Vehicle Type / Model**
   - **Purpose**: Car model information
   - **Alternative names**: "Vehicle Type", "Vehicle_Type", "Model", "model", "Vehicle", "vehicle"

7. **Classification**
   - **Purpose**: Lead classification (HOT, COLD, MEDIUM)
   - **Alternative names**: "Classification", "classification", "CLASSIFICATION"

8. **Date Assigned / Assigned Date**
   - **Purpose**: When the lead was assigned to the employee
   - **Alternative names**: "Date Assigned", "Date_Assigned", "Assigned Date", "Assigned_Date"

9. **Call Date / Follow-up Date**
   - **Purpose**: When the call was made
   - **Alternative names**: "Call Date", "Call_Date", "Follow-up Date", "Follow_up_Date", "Followup Date"

10. **Transaction No / Lead ID**
    - **Purpose**: Unique identifier for the lead
    - **Alternative names**: "Transaction No", "Transaction_No", "TransactionNo", "Lead ID", "Lead_ID", "ID"

## File Format Support
- **Excel**: .xlsx, .xls
- **CSV**: .csv (comma-separated values)

## What the System Does

### 1. Lead Status Breakdown
- Groups all leads by their status
- Shows count and percentage for each status
- Visual chart representation (doughnut chart)

### 2. Call Performance Analysis
- **Successful Calls vs Total Leads**: Calculates success rate percentage
- **Call Result Breakdown**: Groups by successful, failed, no answer, and no call
- Visual chart representation (bar chart)
- Progress bar showing success rate

### 3. Pending Leads Tracking
- Filters leads with status "Open" or "Submit"
- Allows filtering by:
  - Employee ID
  - Status (Open/Submit)
  - Car Model
- Shows all pending leads in a table format

### 4. Employee Performance Metrics
- Total leads assigned per employee
- Successful calls count
- Failed calls count
- No answer count
- Pending leads count
- Success rate percentage per employee

### 5. Overview Statistics
- Total leads count
- Successful calls with percentage
- Pending leads with percentage
- Failed calls count
- No answer count

## Export Features
The system can export a comprehensive Excel report with multiple sheets:
1. **Overview**: Key statistics and metrics
2. **Status Breakdown**: Detailed status distribution
3. **Pending Leads**: All pending leads with details
4. **Employee Performance**: Individual employee statistics
5. **All Leads**: Complete lead data

## Notes
- Column names are case-insensitive and flexible (handles variations)
- The system automatically detects column names with different formats
- Empty or missing values are handled gracefully
- All calculations are performed automatically upon file upload

## Example Data Structure
```
| Assigned To | Status | Call Status | Name      | Contact     | Vehicle Type |
|-------------|--------|-------------|-----------|-------------|--------------|
| EE0001      | Open   | Successful  | John Doe  | 0501234567  | CAMRY        |
| EE0002      | Submit | No Answer   | Jane Smith| 0509876543  | COROLLA      |
| EE0001      | Closed | Successful  | Bob Wilson| 0505555555  | RAV4         |
```

## Troubleshooting
- **No data showing**: Ensure your file has at least the "Status" and "Assigned To" columns
- **Pending leads not showing**: Check that status values are exactly "Open" or "Submit" (case-insensitive)
- **Call performance not accurate**: Ensure "Call Status" column contains recognizable values (Successful, Failed, No Answer, etc.)

