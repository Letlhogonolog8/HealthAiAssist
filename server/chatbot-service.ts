import OpenAI from "openai";
import { getDb } from "./db";

const db = getDb();
import { users, medicalScans, appointments } from "@shared/schema";
import { eq, and, desc, gte } from "drizzle-orm";

// Use system environment variable for OpenAI API key
const apiKey = process.env.OPENAI_API_KEY;
const openai = apiKey ? new OpenAI({ apiKey }) : null;

if (!openai) {
  console.warn('OPENAI_API_KEY not found in environment variables - chatbot will use fallback responses');
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

export interface ChatbotResponse {
  message: string;
  suggestions?: string[];
  actions?: Array<{
    type: 'schedule_appointment' | 'view_results' | 'book_scan' | 'contact_doctor' | 'emergency_alert' | 'health_reminder' | 'medication_tracker' | 'symptom_checker' | 'second_opinion' | 'virtual_consultation' | 'voice_call' | 'video_call' | 'file_upload' | 'medical_search' | 'emergency_call' | 'emergency_location';
    label: string;
    data?: any;
    urgency?: 'low' | 'medium' | 'high' | 'urgent';
    icon?: string;
  }>;
  relatedInfo?: {
    title: string;
    content: string;
  };
  attachments?: Array<{
    type: 'image' | 'document' | 'chart' | 'report';
    url: string;
    title: string;
    preview?: string;
  }>;
  quickReplies?: string[];
  typing?: boolean;
  timestamp?: Date;
  isEmergency?: boolean;
  sentiment?: 'positive' | 'neutral' | 'negative' | 'concerned';
}

class MedicalChatbotService {
  private readonly systemPrompt = `You are MedAI Assistant, a specialized medical AI chatbot for the MedAI cancer detection platform. Your role is to:

1. MEDICAL GUIDANCE: Provide accurate, evidence-based medical information about cancer screening, prevention, and general health
2. PLATFORM ASSISTANCE: Help users navigate the MedAI platform, schedule appointments, understand scan results
3. SUPPORT: Offer emotional support and guidance for patients dealing with health concerns
4. SAFETY: Always recommend consulting healthcare professionals for specific medical advice

IMPORTANT GUIDELINES:
- Never provide specific medical diagnoses or treatment recommendations
- Always encourage users to consult with qualified healthcare professionals
- Be empathetic and supportive, especially when discussing health concerns
- Provide accurate information about cancer types, screening, and prevention
- Help users understand the MedAI platform features and capabilities
- Suggest appropriate next steps (appointments, scans, consultations)
- Do not provide staff member lists or personal information for security reasons

CAPABILITIES:
- Answer questions about cancer types (breast, lung, skin, colon, prostate)
- Explain screening procedures and prevention methods
- Help schedule appointments and scans
- Provide emotional support and guidance
- Explain medical terminology in simple language
- Suggest relevant platform features

Always respond in a caring, professional tone while being informative and helpful.`;

  async generateResponse(
    messages: ChatMessage[], 
    userId?: number,
    userRole?: string
  ): Promise<ChatbotResponse> {
    try {
      // Validate input messages
      if (!messages || messages.length === 0) {
        return this.generateFallbackResponse('Hello', userRole);
      }

      // Use fallback if OpenAI is not available
      if (!openai) {
        return await this.generateFallbackResponse(messages[messages.length - 1]?.content || '', userRole);
      }



      // Get user context if available
      let userContext = "";
      if (userId) {
        const userData = await this.getUserContext(userId);
        userContext = userData;
      }

      // Prepare messages for OpenAI
      const openaiMessages = [
        { role: 'system' as const, content: this.systemPrompt },
        ...(userContext ? [{ role: 'system' as const, content: `User Context: ${userContext}` }] : []),
        ...messages.map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        }))
      ];

      // Log the messages sent to OpenAI for debugging
      console.log("Sending messages to OpenAI:", openaiMessages);

      if (!openai) {
        throw new Error('OpenAI client not initialized');
      }
      
      const completion = await Promise.race([
        openai!.chat.completions.create({
          model: "gpt-4o",
          messages: openaiMessages,
          max_tokens: 400,
          temperature: 0.7
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('OpenAI API timeout')), 8000)
        )
      ]) as any;

      const response = completion.choices[0].message;

      // Basic intent detection using the latest user message (not system messages)
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      const lastContent = (lastUser?.content || '').toLowerCase();
      const isAppointmentRelated = /\b(appointment|schedule|book)\b/.test(lastContent);

      const responseContent = response.content || (isAppointmentRelated
        ? "I can help with appointments. Do you want to schedule, reschedule, or view existing appointments?"
        : "I'm here to help with your health questions and guide you through MedAI's features. How can I assist you today?");

      return {
        message: responseContent,
        suggestions: [
          "📅 Schedule an appointment",
          "What cancer screening do I need?",
          "Explain my scan results",
          "Cancer prevention tips"
        ],
        actions: isAppointmentRelated ? [
          { type: 'schedule_appointment', label: '📅 Schedule Now', data: { redirect: '/appointments' } },
          { type: 'book_scan', label: 'Start Cancer Detection' }
        ] : [
          { type: 'schedule_appointment', label: 'Schedule Appointment' },
          { type: 'book_scan', label: 'Start Cancer Detection' }
        ]
      };

    } catch (error) {
      console.error('Chatbot API error:', error);
      const lastMessage = messages[messages.length - 1]?.content || 'help';
      console.log('Using fallback response for:', lastMessage);
      return await this.generateFallbackResponse(lastMessage, userRole);
    }
  }



  private async getUserContext(userId: number): Promise<string> {
    try {
      // Get user info
      const user = await (db.select() as any)
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user.length) return "";

      const userData = user[0];
      let context = `User: ${userData.fullName}, Role: ${userData.role}`;

      if (userData.age) context += `, Age: ${userData.age}`;
      if (userData.gender) context += `, Gender: ${userData.gender}`;

      // Get recent scans
      const recentScans = await (db.select() as any)
        .from(medicalScans)
        .where(and(
          eq(medicalScans.patientId, userId),
          gte(medicalScans.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) // Last 30 days
        ))
        .orderBy(desc(medicalScans.createdAt))
        .limit(3);

      if (recentScans.length > 0) {
        context += `\nRecent scans: ${recentScans.map((scan: any) => 
          `${scan.scanType} (${scan.status})`
        ).join(', ')}`;
      }

      // Get upcoming appointments
      const upcomingAppointments = await (db.select() as any)
        .from(appointments)
        .where(and(
          eq(appointments.patientId, userId),
          gte(appointments.appointmentDate, new Date())
        ))
        .orderBy(appointments.appointmentDate)
        .limit(2);

      if (upcomingAppointments.length > 0) {
        context += `\nUpcoming appointments: ${upcomingAppointments.length}`;
      }

      return context;
    } catch (error) {
      console.error('Error getting user context:', error);
      return "";
    }
  }

  async getQuickResponses(userRole: string = 'patient'): Promise<string[]> {
    const responses = {
      patient: [
        "What cancer screening do I need for my age?",
        "How do I schedule an appointment?",
        "Explain my recent scan results",
        "What are cancer prevention tips?",
        "How accurate is AI cancer detection?",
        "What should I expect during a scan?"
      ],
      doctor: [
        "Show me today's patient schedule",
        "Review pending scan results",
        "Cancer treatment guidelines",
        "Patient care protocols",
        "Schedule urgent consultation"
      ],
      radiologist: [
        "Review pending scan analyses",
        "AI diagnostic accuracy data",
        "Imaging interpretation guidelines",
        "Case consultation requests"
      ]
    };

    return responses[userRole as keyof typeof responses] || responses.patient;
  }

  async analyzeHealthConcern(symptoms: string, userAge?: number, userGender?: string): Promise<{
    assessment: string;
    recommendations: string[];
    urgencyLevel: 'low' | 'medium' | 'high';
    suggestedScreening?: string[];
  }> {
    try {
      const prompt = `As a medical AI assistant, analyze these health concerns and provide guidance:

Symptoms/Concerns: ${symptoms}
${userAge ? `Age: ${userAge}` : ''}
${userGender ? `Gender: ${userGender}` : ''}

Provide a JSON response with:
- assessment: General health guidance (not diagnosis)
- recommendations: General health recommendations
- urgencyLevel: low/medium/high based on described symptoms
- suggestedScreening: Relevant cancer screenings if applicable

Remember: This is guidance only, not medical diagnosis.`;

      if (!openai) {
        throw new Error('OpenAI client not initialized');
      }
      
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: 'system', content: 'You are a medical guidance AI. Provide helpful health information while emphasizing the need for professional medical consultation.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: "json_object" }
      });

      const result = JSON.parse(completion.choices[0].message.content || '{}');
      
      return {
        assessment: result.assessment || "Please consult with a healthcare professional for proper evaluation.",
        recommendations: result.recommendations || ["Consult with a healthcare provider"],
        urgencyLevel: result.urgencyLevel || 'medium',
        suggestedScreening: result.suggestedScreening || []
      };

    } catch (error) {
      console.error('Health concern analysis error:', error);
      return {
        assessment: "I recommend consulting with a healthcare professional for proper evaluation of your concerns.",
        recommendations: ["Schedule an appointment with your doctor", "Don't delay if symptoms persist"],
        urgencyLevel: 'medium',
        suggestedScreening: []
      };
    }
  }

  // Fallback response generator for when OpenAI API is unavailable
  private async generateFallbackResponse(userMessage: string, userRole: string = 'patient'): Promise<ChatbotResponse> {
    const lowerMessage = userMessage.toLowerCase();
    
    // Cancer screening questions
    if (lowerMessage.includes('screening') || lowerMessage.includes('check') || lowerMessage.includes('test')) {
      return {
        message: "Cancer screening is crucial for early detection. Here are general recommendations:\n\n• Breast cancer: Annual mammograms starting at age 40-50\n• Cervical cancer: Pap smears every 3 years starting at age 21\n• Colorectal cancer: Colonoscopy every 10 years starting at age 45\n• Lung cancer: CT scans for high-risk individuals (heavy smokers)\n• Skin cancer: Annual dermatology exams and monthly self-checks\n\nPlease consult with a healthcare provider for personalized screening recommendations based on your age, risk factors, and family history.",
        suggestions: [
          "Schedule a screening appointment",
          "What are my risk factors?",
          "Explain different screening methods",
          "How often should I get screened?"
        ],
        actions: [
          { type: 'schedule_appointment', label: 'Schedule Screening', data: { type: 'screening' } }
        ]
      };
    }

    // Appointment scheduling
    if (lowerMessage.includes('appointment') || lowerMessage.includes('schedule') || lowerMessage.includes('book')) {
      return {
        message: "📅 **How to Schedule an Appointment:**\n\n**Steps to Book:**\n1. **Login** to your patient account\n2. **Navigate** to the \"Appointments\" section\n3. **Fill out the form** with:\n   • Patient ID\n   • Appointment Date\n   • Appointment Time\n   • Appointment Type (consultation, follow-up, etc.)\n   • Doctor Name (from available medical professionals)\n   • Reason for visit\n4. **Submit** your appointment request\n\n**Available Medical Professionals:**\n• Doctors - General consultations\n• Radiologists - Medical imaging specialists\n\n**Note:** You must be logged in as a patient to book appointments.",
        suggestions: [
          "Go to Appointments page",
          "View available doctors",
          "Help with login",
          "What info do I need?"
        ],
        actions: [
          { type: 'schedule_appointment', label: '📅 Book Appointment', data: { redirect: '/appointments' } }
        ]
      };
    }

    // Scan results
    if (lowerMessage.includes('result') || lowerMessage.includes('scan') || lowerMessage.includes('report')) {
      return {
        message: "Understanding your scan results is important. Here's what you should know:\n\n• AI analysis provides preliminary findings\n• All scans are reviewed by qualified radiologists\n• Results include confidence levels and risk assessments\n• Follow-up recommendations are provided based on findings\n\nFor specific questions about your results, please consult with your healthcare provider or schedule a consultation.",
        suggestions: [
          "View my recent results",
          "What do confidence levels mean?",
          "Schedule results consultation",
          "Explain risk levels"
        ],
        actions: [
          { type: 'view_results', label: 'View Results', data: {} },
          { type: 'schedule_appointment', label: 'Discuss Results', data: { type: 'consultation' } }
        ]
      };
    }

    // Cancer prevention
    if (lowerMessage.includes('prevent') || lowerMessage.includes('risk') || lowerMessage.includes('tips')) {
      return {
        message: "Cancer prevention involves lifestyle choices and regular screening:\n\n• Maintain a healthy diet rich in fruits and vegetables\n• Exercise regularly (at least 150 minutes per week)\n• Avoid tobacco and limit alcohol consumption\n• Protect your skin from excessive sun exposure\n• Get regular screenings based on your age and risk factors\n• Maintain a healthy weight\n• Stay up to date with vaccinations (HPV, Hepatitis B)\n\nRemember, early detection through regular screening is one of the most effective ways to fight cancer.",
        suggestions: [
          "Learn about risk factors",
          "Diet and lifestyle tips",
          "Schedule preventive screening",
          "Family history assessment"
        ]
      };
    }

    // Staff/team questions - restricted for security
    if (lowerMessage.includes('staff') || lowerMessage.includes('team') || lowerMessage.includes('doctor') || lowerMessage.includes('member')) {
      return {
        message: "For security and privacy reasons, I cannot provide staff member lists. However, I can help you schedule an appointment with our healthcare professionals. Our team includes specialists in oncology, radiology, and general medicine.",
        actions: [
          { type: 'schedule_appointment', label: 'Schedule Appointment', data: {} }
        ],
        suggestions: ["Schedule appointment", "Available services", "Contact information"]
      };
    }

    // Platform help
    if (lowerMessage.includes('help') || lowerMessage.includes('how') || lowerMessage.includes('use')) {
      return {
        message: "Welcome to MedAI! I'm here to help you navigate our platform:\n\n• Cancer Detection: Upload medical images for AI analysis\n• Schedule Appointments: Book consultations with healthcare providers\n• View Results: Access your scan results and reports\n• Health Information: Learn about cancer prevention and screening\n• Medical Translator: Understand complex medical terms\n\nWhat would you like to explore?",
        suggestions: [
          "How to use cancer detection",
          "Schedule an appointment",
          "View my health dashboard",
          "Learn about cancer types"
        ],
        actions: [
          { type: 'book_scan', label: 'Start Cancer Detection', data: {} }
        ]
      };
    }

    // Check if user is asking about appointments in any message
    const isAppointmentQuery = lowerMessage.includes('appointment') || 
                              lowerMessage.includes('schedule') ||
                              lowerMessage.includes('book');
    
    if (isAppointmentQuery) {
      return {
        message: "📅 **How to Schedule an Appointment:**\n\n**Steps to Book:**\n1. **Login** to your patient account\n2. **Navigate** to the \"Appointments\" section\n3. **Fill out the form** with:\n   • Patient ID\n   • Appointment Date\n   • Appointment Time\n   • Appointment Type (consultation, follow-up, etc.)\n   • Doctor Name (from available medical professionals)\n   • Reason for visit\n4. **Submit** your appointment request\n\n**Available Medical Professionals:**\n• Doctors - General consultations\n• Radiologists - Medical imaging specialists\n\n**Note:** You must be logged in as a patient to book appointments.",
        suggestions: [
          "Go to Appointments page",
          "View available doctors",
          "Help with login",
          "What info do I need?"
        ],
        actions: [
          { type: 'schedule_appointment', label: '📅 Book Appointment', data: { redirect: '/appointments' } }
        ]
      };
    }
    
    // Default response
    return {
      message: `Hello! I'm your MedAI Assistant. I can help you with:\n\n• **📅 Appointment Scheduling** - Book consultations with doctors\n• Cancer screening information\n• Understanding scan results\n• Health prevention tips\n• Platform navigation\n\nWhat would you like to do today?`,
      suggestions: [
        "📅 Schedule an appointment",
        "Cancer screening guidelines", 
        "Explain my scan results",
        "Cancer prevention tips",
        "How to use MedAI platform"
      ],
      actions: [
        { type: 'schedule_appointment', label: '📅 Schedule Appointment', data: { redirect: '/appointments' } },
        { type: 'book_scan', label: 'Start Cancer Detection', data: {} }
      ]
    };
  }
}

export const medicalChatbotService = new MedicalChatbotService();