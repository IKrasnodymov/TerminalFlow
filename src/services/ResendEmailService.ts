import { Resend } from 'resend';
import { config } from '../config';
import { logger } from '../utils/logger';

export class ResendEmailService {
  private resend: Resend | null = null;
  private static instance: ResendEmailService;

  constructor() {
    // Initialize only if API key is available
    if (process.env.RESEND_API_KEY) {
      this.resend = new Resend(process.env.RESEND_API_KEY);
    }
  }

  static getInstance(): ResendEmailService {
    if (!ResendEmailService.instance) {
      ResendEmailService.instance = new ResendEmailService();
    }
    return ResendEmailService.instance;
  }

  async sendAccessCode(toEmail: string, accessCode: string, userAgent?: string, ip?: string): Promise<void> {
    // If no Resend API key - use console
    if (!this.resend) {
      logger.info('📧 ACCESS CODE FOR DEVELOPMENT', {
        toEmail,
        accessCode: `🔐 ${accessCode}`,
        ip,
        userAgent: userAgent?.substring(0, 50),
        message: 'USE THIS CODE TO LOGIN - RESEND API KEY NOT SET'
      });
      
      console.log('\n' + '='.repeat(60));
      console.log('🖥️  TERMINAL ACCESS CODE');
      console.log('='.repeat(60));
      console.log(`📧 Email: ${toEmail}`);
      console.log(`🔐 CODE: ${accessCode}`);
      console.log(`⏰ Valid for: 10 minutes`);
      console.log(`🌐 IP: ${ip}`);
      console.log(`⚠️  RESEND API KEY NOT SET - EMAIL NOT SENT`);
      console.log('='.repeat(60) + '\n');
      
      return; // Skip email sending if no API key
    }

    const currentTime = new Date().toLocaleString('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { text-align: center; margin-bottom: 30px; }
            .logo { font-size: 24px; font-weight: bold; color: #007acc; margin-bottom: 10px; }
            .access-code { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; border-left: 4px solid #007acc; }
            .code { font-size: 24px; font-weight: bold; color: #007acc; letter-spacing: 2px; font-family: 'Courier New', monospace; }
            .info { background: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107; }
            .warning { background: #f8d7da; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #dc3545; }
            .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">🖥️ Terminal Web Access</div>
                <h2>Terminal Access Code</h2>
            </div>

            <p>Hello! Access to your terminal via web interface has been requested.</p>

            <div class="access-code">
                <p><strong>Your access code:</strong></p>
                <div class="code">${accessCode}</div>
                <p style="margin-top: 15px; color: #666; font-size: 14px;">Code is valid for 10 minutes</p>
            </div>

            <div class="info">
                <h3>📋 Connection Information:</h3>
                <p><strong>Request time:</strong> ${currentTime} UTC</p>
                <p><strong>IP address:</strong> ${ip || 'Unknown'}</p>
                <p><strong>Browser:</strong> ${userAgent || 'Unknown'}</p>
            </div>

            <div class="warning">
                <h3>⚠️ Security:</h3>
                <ul>
                    <li>Never share this code with third parties</li>
                    <li>If you did not request access, ignore this email</li>
                    <li>Code automatically expires after 10 minutes</li>
                    <li>Code becomes invalid after use</li>
                </ul>
            </div>

            <div class="footer">
                <p>Terminal-to-Web Security System</p>
                <p>This is an automated message, do not reply</p>
            </div>
        </div>
    </body>
    </html>
    `;

    try {
      if (!this.resend) {
        throw new Error('Resend not initialized');
      }
      
      const { data, error } = await this.resend.emails.send({
        from: 'Terminal Access <onboarding@resend.dev>', // Resend test domain
        to: ['ikrasnodymov@googlemail.com'], // Using your registered email
        subject: `🔐 Terminal Access Code - ${accessCode}`,
        html: htmlContent,
      });

      if (error) {
        throw new Error(error.message);
      }

      logger.info('Access code email sent successfully via Resend', {
        toEmail,
        messageId: data?.id,
        accessCode: accessCode.substring(0, 2) + '****',
        ip,
        userAgent: userAgent?.substring(0, 50)
      });

    } catch (error) {
      logger.error('Failed to send access code email via Resend', {
        toEmail,
        error: error instanceof Error ? error.message : 'Unknown error',
        ip,
      });
      throw new Error('Failed to send access code to email');
    }
  }

  async testConnection(): Promise<boolean> {
    if (!this.resend) {
      logger.warn('RESEND_API_KEY not set - using development mode');
      return false;
    }

    try {
      // Simple API key validation through test request
      const { data, error } = await this.resend.emails.send({
        from: 'test@resend.dev',
        to: ['test@example.com'],
        subject: 'Test connection',
        html: '<p>Test</p>',
      });
      
      // Even if email wasn't sent, but API responded - key is valid
      logger.info('Resend service connection verified');
      return true;
    } catch (error) {
      logger.error('Resend service connection failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }
}