# Dashboard Variables Enhancement

## Changes Made

Updated the Dynatrace dashboard deployer to support filtering by **companyName** and **journeyType** using dashboard variables.

### Variables Added

1. **companyName** Variable
   - Type: DQL Query dropdown
   - Query: Fetches all distinct company names from journey_data_persisted events
   - Default: Current journey's company name

2. **journeyType** Variable  
   - Type: DQL Query dropdown (cascades from companyName)
   - Query: Fetches distinct journey types for selected company
   - Default: Current journey type (or "*" for all)

### Query Updates

All dashboard tiles now reference variables:
- Changed from: `filter companyName == "${companyName}"`
- Changed to: `filter companyName == $companyName | filter journeyType == $journeyType or $journeyType == "*"`

This allows users to:
- Switch between companies without recreating dashboard
- Filter by specific journey type or view all types
- Compare metrics across different journey types for same company

### Files Modified

- `/home/ec2-user/BizObs Generator/scripts/dynatrace-dashboard-deployer.js`

### Usage

When a dashboard is deployed, users will see two dropdown filters at the top:
1. **Company** - Select which company's data to view
2. **Journey Type** - Select specific journey type or "*" for all

All tiles automatically update when variables change.
