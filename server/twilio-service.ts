import twilio from 'twilio';
import dotenv from 'dotenv';

dotenv.config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

console.log('Twilio config check:', {
  accountSid: accountSid ? 'Set' : 'Missing',
  authToken: authToken ? 'Set' : 'Missing', 
  phoneNumber: twilioPhoneNumber ? 'Set' : 'Missing'
});

if (!accountSid || !authToken || !twilioPhoneNumber) {
  console.warn('Twilio credentials not configured');
}

const client = accountSid && authToken ? twilio(accountSid, authToken) : null;

export class TwilioService {
  // Generate access token for client-side calling
  static generateAccessToken(identity: string) {
    if (!client) return null;
    
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const accessToken = new AccessToken(
      accountSid!,
      accountSid!, // Use Account SID as API Key for basic setup
      authToken!, // Use Auth Token as API Secret for basic setup
      { identity }
    );

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: undefined, // Not required for basic calling
      incomingAllow: false, // Disable incoming for now
    });

    accessToken.addGrant(voiceGrant);
    return accessToken.toJwt();
  }

  /**
   * Escapes text destined for a TwiML document.
   *
   * The caller's display name was interpolated into the TwiML below raw. A
   * fullName is chosen by the user at registration, so a name containing
   *
   *   </Say><Dial>+1900...</Dial><Say>
   *
   * closed the Say element and added a Dial verb, and the platform placed a
   * second call to a number of the attacker's choosing, billed to this Twilio
   * account. Anything interpolated into markup has to be escaped as markup.
   */
  private static escapeXml(value: string): string {
    return value.replace(/[<>&'"]/g, (char) => {
      switch (char) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case "'": return '&apos;';
        default: return '&quot;';
      }
    });
  }

  /** E.164: a leading + and 8-15 digits. */
  static isValidPhoneNumber(value: string): boolean {
    return /^\+[1-9]\d{7,14}$/.test(value.trim());
  }

  // Make outbound call
  static async makeCall(toPhoneNumber: string, fromUser: string) {
    if (!client) throw new Error('Twilio not configured');

    const to = toPhoneNumber.trim();
    if (!TwilioService.isValidPhoneNumber(to)) {
      // Rejected here as well as at the route, because this is the boundary that
      // actually spends money.
      throw new Error('Recipient phone number is not in E.164 format');
    }

    try {
      const speaker = TwilioService.escapeXml(fromUser).slice(0, 100);
      const call = await client.calls.create({
        to,
        from: twilioPhoneNumber!,
        twiml: `<Response><Say>Hello, you have a call from ${speaker} from the medical platform.</Say></Response>`
      });

      return { success: true, callSid: call.sid };
    } catch (error) {
      console.error('Twilio call error:', error);
      throw error;
    }
  }

  // End call
  static async endCall(callSid: string) {
    if (!client) throw new Error('Twilio not configured');

    try {
      await client.calls(callSid).update({ status: 'completed' });
      return { success: true };
    } catch (error) {
      console.error('End call error:', error);
      throw error;
    }
  }
}