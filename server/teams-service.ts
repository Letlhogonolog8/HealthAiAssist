import { Client } from '@microsoft/microsoft-graph-client';
import { AuthenticationProvider } from '@microsoft/microsoft-graph-client';

// Simple auth provider for Teams integration
class TeamsAuthProvider implements AuthenticationProvider {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async getAccessToken(): Promise<string> {
    return this.accessToken;
  }
}

export class TeamsService {
  private client: Client | null = null;

  constructor(accessToken?: string) {
    if (accessToken) {
      const authProvider = new TeamsAuthProvider(accessToken);
      this.client = Client.initWithMiddleware({ authProvider });
    }
  }

  // Create Teams meeting
  async createMeeting(subject: string, participantEmails: string[]) {
    if (!this.client) {
      // Fallback: Generate meeting URL without Graph API
      return this.createFallbackMeeting(subject, participantEmails);
    }

    try {
      const meeting = {
        subject: subject,
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
        participants: {
          attendees: participantEmails.map(email => ({
            emailAddress: {
              address: email,
              name: email.split('@')[0]
            }
          }))
        }
      };

      const result = await this.client.api('/me/onlineMeetings').post(meeting);
      
      return {
        meetingId: result.id,
        joinUrl: result.joinWebUrl,
        subject: result.subject,
        startTime: result.startDateTime
      };
    } catch (error) {
      console.error('Teams API error:', error);
      return this.createFallbackMeeting(subject, participantEmails);
    }
  }

  // Fallback meeting creation without Graph API
  private createFallbackMeeting(subject: string, participantEmails: string[]) {
    const meetingId = `meeting-${Date.now()}`;
    const encodedSubject = encodeURIComponent(subject);
    
    // Generate Teams meeting URL (this would normally come from Graph API)
    const joinUrl = `https://teams.microsoft.com/l/meetup-join/19%3ameeting_${meetingId}%40thread.v2/0?context=%7b%22Tid%22%3a%22tenant-id%22%2c%22Oid%22%3a%22organizer-id%22%7d`;
    
    return {
      meetingId,
      joinUrl,
      subject,
      startTime: new Date().toISOString(),
      fallback: true
    };
  }

  // End Teams meeting
  async endMeeting(meetingId: string) {
    if (!this.client) {
      return { success: true, fallback: true };
    }

    try {
      await this.client.api(`/me/onlineMeetings/${meetingId}`).delete();
      return { success: true };
    } catch (error) {
      console.error('Error ending Teams meeting:', error);
      return { success: false, error: (error as Error).message };
    }
  }
}