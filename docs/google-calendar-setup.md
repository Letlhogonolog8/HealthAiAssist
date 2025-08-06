# Google Calendar Integration Setup

This guide explains how to set up Google Calendar integration to prevent appointment conflicts with external calendar events.

## Prerequisites

1. Google Cloud Platform account
2. Google Calendar with events you want to check against

## Setup Steps

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the Google Calendar API:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Calendar API"
   - Click "Enable"

### 2. Create Service Account

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "Service Account"
3. Fill in service account details
4. Click "Create and Continue"
5. Skip role assignment (click "Continue")
6. Click "Done"

### 3. Generate Service Account Key

1. Click on the created service account
2. Go to "Keys" tab
3. Click "Add Key" > "Create new key"
4. Select "JSON" format
5. Download the key file

### 4. Share Calendar with Service Account

1. Open Google Calendar
2. Find the calendar you want to integrate
3. Click the three dots next to calendar name
4. Select "Settings and sharing"
5. Under "Share with specific people", add the service account email
6. Give "See all event details" permission
7. Copy the Calendar ID from "Integrate calendar" section

### 5. Configure Environment Variables

Add these variables to your `.env` file:

```bash
# Google Calendar Integration
GOOGLE_CALENDAR_CREDENTIALS={"type":"service_account","project_id":"your-project-id","private_key_id":"key-id","private_key":"-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n","client_email":"service-account@your-project.iam.gserviceaccount.com","client_id":"client-id","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token"}
GOOGLE_CALENDAR_ID=your-calendar-id@group.calendar.google.com
```

**Important**: Replace the credentials JSON with the actual content from your downloaded key file (as a single line).

## How It Works

1. **Appointment Booking**: When a user tries to book an appointment, the system first checks Google Calendar for conflicts
2. **Time Slot Filtering**: Available time slots are filtered to exclude times with existing calendar events
3. **Conflict Prevention**: If a time slot has a conflicting event, the booking is rejected with details about the conflict
4. **Fallback Mode**: If Google Calendar is not configured, the system works normally without external calendar checking

## Testing the Integration

1. Create an event in your Google Calendar for August 1st, 2025
2. Try to book an appointment for the same time slot
3. The system should reject the booking and show the conflict

## Troubleshooting

### Common Issues

1. **"Google Calendar not configured"**: Check that environment variables are set correctly
2. **"Permission denied"**: Ensure the service account has access to the calendar
3. **"Calendar not found"**: Verify the Calendar ID is correct

### Debug Mode

Check the calendar service status via the admin panel or API endpoint:
```
GET /api/admin/calendar-status
```

### Logs

The system logs calendar conflicts to help with debugging:
```
Time slot 09:00 AM on 2025-08-01 unavailable due to: Meeting with Dr. Smith
```

## Security Notes

- Keep your service account key secure
- Don't commit credentials to version control
- Use environment variables for all sensitive data
- Consider using Google Cloud Secret Manager for production

## Limitations

- Currently supports read-only calendar access
- Checks conflicts for 1-hour appointment slots
- Requires manual calendar sharing setup
- Service account approach (not OAuth user flow)