# HealthAI Assistant Chatbot System Instructions

## Overview
The HealthAI Assistant chatbot is an AI-powered medical assistant integrated into the HealthAI cancer detection platform. It provides intelligent support for patients, doctors, radiologists, and administrators using OpenAI's GPT-4 model with specialized medical knowledge.

## System Architecture

### Core Components
- **Service**: `server/chatbot-service.ts` - Main chatbot logic and OpenAI integration
- **API Endpoint**: `/api/chatbot/chat` - RESTful chat interface
- **WebSocket**: Real-time chat capabilities via WebSocket connection
- **Database Integration**: User context and conversation history

### Technology Stack
- **AI Model**: OpenAI GPT-4 (gpt-4o)
- **Backend**: Node.js/Express with TypeScript
- **Database**: PostgreSQL with SQLite fallback
- **Real-time**: WebSocket for live chat
- **Authentication**: Session-based user authentication

## Chatbot Capabilities

### 1. Medical Guidance
- Cancer screening information and recommendations
- Prevention tips and lifestyle advice
- Medical terminology explanations
- Risk assessment guidance
- Treatment option explanations (general)

### 2. Platform Navigation
- Help with using HealthAI features
- Appointment scheduling assistance
- Scan result interpretation
- Dashboard navigation
- Feature explanations

### 3. Role-Based Assistance
**Patients:**
- Cancer screening guidelines
- Appointment booking help
- Scan result explanations
- Health prevention tips
- Symptom assessment guidance

**Doctors:**
- Patient management assistance
- Clinical decision support
- Treatment protocol guidance
- Case consultation help
- Administrative task support

**Radiologists:**
- Image analysis insights
- Diagnostic assistance
- Report generation help
- Quality assurance guidance
- Technical support

**Administrators:**
- System management help
- User account assistance
- Analytics interpretation
- Configuration guidance
- Troubleshooting support

### 4. Emergency Response
- Critical case identification
- Urgent care recommendations
- Emergency contact guidance
- Immediate action protocols
- Specialist referral assistance

## System Prompt Configuration

### Core Identity
```
You are MedAI Assistant, a specialized medical AI chatbot for the MedAI cancer detection platform.
```

### Primary Functions
1. **Medical Guidance**: Evidence-based medical information
2. **Platform Assistance**: Navigation and feature help
3. **Support**: Emotional support for health concerns
4. **Safety**: Always recommend professional consultation

### Safety Guidelines
- Never provide specific medical diagnoses
- Always encourage professional healthcare consultation
- Maintain empathetic and supportive tone
- Provide accurate, evidence-based information
- Suggest appropriate next steps and actions

## API Integration

### Chat Endpoint
```
POST /api/chatbot/chat
```

**Request Format:**
```json
{
  "messages": [
    {
      "role": "user|assistant|system",
      "content": "message content",
      "timestamp": "ISO date string"
    }
  ],
  "userId": "number (optional)",
  "userRole": "patient|doctor|radiologist|admin"
}
```

**Response Format:**
```json
{
  "message": "AI response text",
  "suggestions": ["suggestion1", "suggestion2"],
  "actions": [
    {
      "type": "schedule_appointment|view_results|book_scan|contact_doctor",
      "label": "Action Label",
      "data": {},
      "urgency": "low|medium|high|urgent",
      "icon": "icon-name"
    }
  ],
  "relatedInfo": {
    "title": "Information Title",
    "content": "Additional information"
  },
  "quickReplies": ["Quick reply 1", "Quick reply 2"],
  "isEmergency": false,
  "sentiment": "positive|neutral|negative|concerned"
}
```

## User Context Integration

### Automatic Context Loading
The chatbot automatically loads user context including:
- User profile (name, role, age, gender)
- Recent medical scans (last 30 days)
- Upcoming appointments
- Medical history (when available)
- Previous chat interactions

### Context Usage
- Personalized responses based on user role
- Relevant suggestions for user's medical history
- Appointment scheduling with user preferences
- Scan result explanations tailored to user level

## Fallback System

### OpenAI API Unavailable
When OpenAI API is unavailable, the system provides:
- Pre-configured responses for common queries
- Cancer screening information
- Appointment scheduling help
- Platform navigation assistance
- Emergency contact information

### Fallback Response Categories
1. **Cancer Screening**: Guidelines and recommendations
2. **Appointments**: Scheduling and management help
3. **Scan Results**: General interpretation guidance
4. **Prevention**: Health tips and lifestyle advice
5. **Platform Help**: Feature explanations and navigation

## Quick Response Templates

### Patient Quick Responses
- "What cancer screening do I need for my age?"
- "How do I schedule an appointment?"
- "Explain my recent scan results"
- "What are cancer prevention tips?"
- "How accurate is AI cancer detection?"
- "What should I expect during a scan?"

### Doctor Quick Responses
- "Show me today's patient schedule"
- "Review pending scan results"
- "Cancer treatment guidelines"
- "Patient care protocols"
- "Schedule urgent consultation"

### Radiologist Quick Responses
- "Review pending scan analyses"
- "AI diagnostic accuracy data"
- "Imaging interpretation guidelines"
- "Case consultation requests"

## Health Concern Analysis

### Symptom Assessment
The chatbot can analyze health concerns and provide:
- General health guidance (not diagnosis)
- Urgency level assessment (low/medium/high)
- Recommended actions and next steps
- Suggested screening types
- Professional consultation recommendations

### Risk Assessment
- Age-based screening recommendations
- Family history considerations
- Lifestyle factor analysis
- Symptom severity evaluation
- Urgency determination

## Action Types

### Available Actions
- `schedule_appointment`: Book medical appointments
- `view_results`: Access scan results and reports
- `book_scan`: Start cancer detection process
- `contact_doctor`: Reach healthcare providers
- `emergency_alert`: Critical situation handling
- `health_reminder`: Preventive care reminders
- `medication_tracker`: Medication management
- `symptom_checker`: Symptom assessment
- `second_opinion`: Specialist consultation
- `virtual_consultation`: Telemedicine options

### Emergency Actions
- `emergency_call`: Direct emergency contact
- `emergency_location`: Location-based emergency services
- `voice_call`: Immediate voice consultation
- `video_call`: Video consultation setup

## Configuration Settings

### OpenAI Configuration
```javascript
{
  model: "gpt-4o",
  max_tokens: 400,
  temperature: 0.7,
  timeout: 8000
}
```

### Response Limits
- Maximum response length: 400 tokens
- Conversation timeout: 8 seconds
- Context window: Last 10 messages
- User context refresh: Every request

## Error Handling

### API Errors
- OpenAI API timeout: Fallback to pre-configured responses
- Rate limiting: Queue requests and retry
- Authentication errors: Log and use fallback
- Network errors: Graceful degradation

### User Errors
- Invalid input: Helpful error messages
- Missing context: Request clarification
- Ambiguous queries: Provide options
- Emergency situations: Immediate escalation

## Security Considerations

### Data Protection
- Conversations are stored, and the message body is encrypted at rest
  (`chat_messages.message`, see `server/crypto/encrypted-fields.ts`)
- Session-based user identification
- TLS in transit
- Sensitive operations recorded in `audit_events`

### Privacy Compliance
- **South African law applies: POPIA, not HIPAA.** No HIPAA claim is made, and
  none would be meaningful here — it is a United States statute governing
  covered entities under US healthcare law.
- Messages sent to the assistant are forwarded to OpenAI in the United States.
  That is a POPIA §72 cross-border transfer and is handled as one: text is
  redacted before it leaves, consent is checked on every message rather than
  once at signup, the disclosure version the patient saw is recorded, and each
  transfer is logged with data categories but never the values. See
  `server/privacy/external-processing.ts`.
- Consent is revocable, and revocation takes effect on the next message.

> This section previously read "No storage of sensitive medical information" and
> "HIPAA-compliant data handling". The first was untrue — conversations are
> persisted — and the second was a regulatory assertion the project does not
> hold, about a jurisdiction it does not operate in.

## Monitoring and Analytics

### Performance Metrics
- Response time tracking
- User satisfaction scores
- Conversation completion rates
- Fallback usage statistics
- Error rate monitoring

### Usage Analytics
- Most common queries
- User engagement patterns
- Feature utilization rates
- Success rate by user role
- Emergency escalation frequency

## Deployment Configuration

### Environment Variables
```bash
OPENAI_API_KEY=${OPENAI_API_KEY}
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@host:5432/db
SESSION_SECRET=your-secure-secret
```

### System Requirements
- Node.js 18+
- PostgreSQL 12+ (SQLite fallback)
- OpenAI API access
- WebSocket support
- SSL/TLS encryption

## Testing and Validation

### Test Scenarios
1. **Basic Conversation**: Simple Q&A interactions
2. **Medical Queries**: Cancer-related questions
3. **Emergency Situations**: Critical case handling
4. **Platform Navigation**: Feature assistance
5. **Appointment Scheduling**: Booking workflows
6. **Fallback Testing**: API unavailable scenarios

### Quality Assurance
- Response accuracy validation
- Medical information verification
- Safety guideline compliance
- User experience testing
- Performance benchmarking

## Maintenance and Updates

### Regular Maintenance
- OpenAI API key rotation
- Model version updates
- Response template updates
- Performance optimization
- Security patches

### Content Updates
- Medical guideline updates
- Platform feature changes
- New action type additions
- Emergency protocol updates
- User feedback integration

## Support and Troubleshooting

### Common Issues
1. **OpenAI API Key Issues**: Verify environment variable setup
2. **Slow Responses**: Check API timeout settings
3. **Fallback Activation**: Monitor API availability
4. **Context Loading**: Verify database connections
5. **WebSocket Issues**: Check connection stability

### Debug Mode
```bash
NODE_ENV=development npm run dev
```

### Logging
- All chat interactions logged
- Error tracking and reporting
- Performance metrics collection
- User feedback capture
- System health monitoring

## Future Enhancements

### Planned Features
- Multi-language support
- Voice interaction capabilities
- Advanced medical knowledge base
- Predictive health analytics
- Integration with wearable devices
- Telemedicine platform integration

### AI Model Improvements
- Fine-tuning for medical domain
- Custom medical knowledge base
- Improved context understanding
- Better emergency detection
- Enhanced personalization

---

## Quick Start Guide

### 1. Setup OpenAI API Key
```bash
# Windows System Environment Variables
Win + R → sysdm.cpl → Environment Variables
Variable: OPENAI_API_KEY
Value: ${OPENAI_API_KEY}
```

### 2. Test API Connection
```bash
node server/test-openai.mjs
```

### 3. Start Application
```bash
npm run dev
```

### 4. Access Chatbot
- Navigate to any dashboard
- Click on chat/help icon
- Start conversation with AI assistant

The HealthAI Assistant chatbot is designed to provide comprehensive medical support while maintaining the highest standards of safety, accuracy, and user experience.