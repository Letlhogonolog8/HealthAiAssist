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

  // Make outbound call
  static async makeCall(toPhoneNumber: string, fromUser: string) {
    if (!client) throw new Error('Twilio not configured');

    try {
      const call = await client.calls.create({
        to: toPhoneNumber,
        from: twilioPhoneNumber!,
        twiml: `<Response><Say>Hello, you have a call from ${fromUser} from the medical platform.</Say></Response>`
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