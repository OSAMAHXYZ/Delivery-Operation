## 🚀 Quick Start Guide

### Testing the Application

1. **Launch the App**
   - The app should now be running on macOS
   - You'll see the "Lead Distribution Admin" page

2. **Upload Sample Data**
   - Click "Select Excel/CSV File"
   - Navigate to the project folder
   - Select `sample_leads.csv`
   - The system will automatically parse and distribute leads

3. **View Distribution**
   - **Tree View**: Expandable categories showing agent assignments
   - **Summary Table**: Matrix view of leads per agent per category

4. **Test Agent Management**
   - Click on agent chips (AGENT_01, AGENT_02, etc.) to toggle status
   - Active agents show green, inactive show gray
   - Click "Rebalance" to redistribute leads to active agents only

5. **Export Results**
   - Click "Export Assignments" to download full lead list with assignments
   - Click "Export Summary" to download summary statistics
   - Files are saved to your Documents folder

### Expected Results

With the sample CSV (215 leads):
- Leads grouped by car model (Corolla, Camry, RAV4, etc.)
- Distributed equally across 5 agents
- Each agent gets approximately the same number of leads per category

### Testing Scenarios

#### Scenario 1: Normal Distribution
- All 5 agents active
- Upload file
- Verify equal distribution in summary table

#### Scenario 2: Agent Unavailable
- Mark AGENT_01 as Sick/OOO (click the chip)
- Click "Rebalance"
- Leads redistributed to remaining 4 agents
- Verify AGENT_01 has 0 leads

#### Scenario 3: Multiple Agents Unavailable
- Mark 2-3 agents as unavailable
- Click "Rebalance"
- All leads distributed to remaining active agents

#### Scenario 4: Backorder Handling
- The sample data includes backorders (leads with "NO ORDER" status)
- These are automatically combined with new leads
- Total pool is distributed equally

### Troubleshooting

**Issue**: File upload fails
- **Solution**: Ensure CSV is tab-delimited format

**Issue**: No leads showing
- **Solution**: Check that CSV has the expected column structure

**Issue**: Export not working
- **Solution**: Check permissions for Documents folder

### Data Format

Sample lead structure in CSV:
```
Transaction No | Prospect Name | Model | Classification | Status
2095877        | Khalil Ullah  | RAV 4 | Hot           | Submit
2096425        | فالح ال عميره | Camry | Cold          | Open
```

### Agent Status Meanings

- 🟢 **Active**: Receiving lead assignments
- ⚪ **Sick/OOO**: Not receiving new assignments, existing leads redistributed

---

## 📋 Code Quality Checklist

✅ **Clean Architecture**
- Domain layer independent of frameworks
- Business logic isolated in services
- Clear separation of concerns

✅ **SOLID Principles**
- Single Responsibility: Each class has one job
- Open/Closed: Extensible without modification
- Dependency Inversion: Depends on abstractions

✅ **Best Practices**
- Immutable models with Equatable
- State management with Riverpod
- Error handling with try-catch
- User feedback with SnackBars

✅ **Type Safety**
- Strong typing throughout
- Null safety enabled
- Proper error types

---

Enjoy testing the Lead Distribution System! 🎉
