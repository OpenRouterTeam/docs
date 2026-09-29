# Generic CSV Refund Script

This script processes a CSV file containing user IDs and credit amounts to issue refunds or credits.

## Usage

1. **Prepare your CSV file**: Create a `refund_data.csv` file in this directory with the following format:
   ```csv
   clerk_user_id,credit_amount
   user_123456789,10.50
   user_987654321,-5.25
   ```

2. **Set up environment** (optional): 
   ```bash
   export CREDIT_NOTE="Your custom incident description"
   ```
   If not set, uses default: "Production incident refund - Generic CSV processing"

3. **Run in dry-run mode first**:
   ```bash
   cd /path/to/openrouter-web
   bunx tsx scripts/incidents/generic-csv-refund/index.ts
   ```
   Select "dry" mode to preview changes without making them.

4. **Execute the refunds**:
   Run the script again and select "proceed" mode to actually insert the credits.

## CSV Format

- **clerk_user_id**: The Clerk user ID (required, non-empty string)
- **credit_amount**: The credit amount (required, valid number)
  - Positive values add credits to the user's account
  - Negative values are refunds (subtract from usage/add to balance)

## Safety Features

- **Duplicate prevention**: Won't create duplicate credits for users who already have credits with the same note
- **Dry-run mode**: Preview all changes before executing
- **Data validation**: Validates CSV format and data types
- **Detailed logging**: Comprehensive logging of all operations

## Files Generated

- `.logs/dry-run-summary.ignore.json`: Summary of dry-run results
- `.logs/`: Directory containing all log files (git-ignored)

## Example Output

```
? Processing CSV refunds with note: "Production incident refund - Generic CSV processing" dry
✓ Successfully parsed CSV file { total_records: 4, file_path: '/path/to/refund_data.csv' }
✓ Dry run summary written to file { 
    file_path: '/path/to/.logs/dry-run-summary.ignore.json',
    summary: { total_records: 4, total_amount: 14.5, positive_credits: 2, negative_credits: 2 }
  }
```
