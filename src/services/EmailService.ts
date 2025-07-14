import nodemailer from 'nodemailer';
import { config } from '../config';
import { logger } from '../utils/logger';

export class EmailService {
  private transporter: nodemailer.Transporter;
  private static instance: EmailService;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: config.emailUser,
        pass: config.emailPassword,
      },
      tls: {
        rejectUnauthorized: false
      },
      connectionTimeout: 10000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      logger: true,
      debug: config.nodeEnv === 'development'
    });
  }

  static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  async sendAccessCode(toEmail: string, accessCode: string, userAgent?: string, ip?: string): Promise<void> {
    // Development solution - output code to console
    if (config.nodeEnv === 'development') {
      logger.info('📧 ACCESS CODE FOR DEVELOPMENT', {
        toEmail,
        accessCode: `🔐 ${accessCode}`,
        ip,
        userAgent: userAgent?.substring(0, 50),
        message: 'USE THIS CODE TO LOGIN'
      });
      
      console.log('\n' + '='.repeat(60));
      console.log('🖥️  TERMINAL ACCESS CODE');
      console.log('='.repeat(60));
      console.log(`📧 Email: ${toEmail}`);
      console.log(`🔐 CODE: ${accessCode}`);
      console.log(`⏰ Valid for: 10 minutes`);
      console.log(`🌐 IP: ${ip}`);
      console.log('='.repeat(60) + '\n');
      
      return; // Skip email sending in development
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
            table { width: 100%; border-collapse: collapse; margin: 10px 0; }
            th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; }
            th { background-color: #f8f9fa; font-weight: bold; }
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
                <table>
                    <tr><th>Request time:</th><td>${currentTime} UTC</td></tr>
                    <tr><th>IP address:</th><td>${ip || 'Unknown'}</td></tr>
                    <tr><th>Browser:</th><td>${userAgent || 'Unknown'}</td></tr>
                </table>
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

            <div style="text-align: center; margin: 30px 0;">
                <p>To access the terminal, click the link:</p>
                <a href="http://localhost:${config.port}" style="display: inline-block; background: #007acc; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">Open Terminal</a>
            </div>

            <div class="footer">
                <p>Terminal-to-Web Security System</p>
                <p>This is an automated message, do not reply</p>
            </div>
        </div>
    </body>
    </html>
    `;

    const textContent = `
🖥️ Terminal Web Access - Access Code

Hello! Access to your terminal via web interface has been requested.

ACCESS CODE: ${accessCode}

Connection Information:
- Time: ${currentTime} UTC
- IP: ${ip || 'Unknown'}
- Browser: ${userAgent || 'Unknown'}

⚠️ SECURITY:
- Never share this code with third parties
- Code is valid for 10 minutes
- Code becomes invalid after use

To access: http://localhost:${config.port}

Terminal-to-Web Security System
    `;

    const mailOptions = {
      from: {
        name: 'Terminal Web Access',
        address: config.emailUser,
      },
      to: toEmail,
      subject: `🔐 Terminal Access Code - ${accessCode}`,
      text: textContent,
      html: htmlContent,
    };

    try {
      // Add timeout for email sending
      const sendPromise = this.transporter.sendMail(mailOptions);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Email sending timeout')), 15000);
      });
      
      const info = await Promise.race([sendPromise, timeoutPromise]) as any;
      
      logger.info('Access code email sent successfully', {
        toEmail,
        messageId: info.messageId,
        accessCode: accessCode.substring(0, 2) + '****', // Log only first 2 chars
        ip,
        userAgent: userAgent?.substring(0, 50) // Truncate long user agents
      });
      
    } catch (error) {
      logger.error('Failed to send access code email', {
        toEmail,
        error: error instanceof Error ? error.message : 'Unknown error',
        ip,
      });
      throw new Error('Failed to send access code to email');
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      logger.info('Email service connection verified');
      return true;
    } catch (error) {
      logger.error('Email service connection failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }
}