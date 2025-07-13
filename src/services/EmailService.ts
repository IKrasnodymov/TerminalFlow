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
    // Временное решение для разработки - вывод кода в консоль
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
    const currentTime = new Date().toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
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
                <h2>Код доступа к терминалу</h2>
            </div>

            <p>Привет! Запрошен доступ к вашему терминалу через веб-интерфейс.</p>

            <div class="access-code">
                <p><strong>Ваш код доступа:</strong></p>
                <div class="code">${accessCode}</div>
                <p style="margin-top: 15px; color: #666; font-size: 14px;">Код действителен в течение 10 минут</p>
            </div>

            <div class="info">
                <h3>📋 Информация о подключении:</h3>
                <table>
                    <tr><th>Время запроса:</th><td>${currentTime}</td></tr>
                    <tr><th>IP адрес:</th><td>${ip || 'Неизвестно'}</td></tr>
                    <tr><th>Браузер:</th><td>${userAgent || 'Неизвестно'}</td></tr>
                </table>
            </div>

            <div class="warning">
                <h3>⚠️ Безопасность:</h3>
                <ul>
                    <li>Никогда не передавайте этот код третьим лицам</li>
                    <li>Если вы не запрашивали доступ, проигнорируйте это письмо</li>
                    <li>Код автоматически истекает через 10 минут</li>
                    <li>После использования код становится недействительным</li>
                </ul>
            </div>

            <div style="text-align: center; margin: 30px 0;">
                <p>Для доступа к терминалу перейдите по ссылке:</p>
                <a href="http://localhost:${config.port}" style="display: inline-block; background: #007acc; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">Открыть терминал</a>
            </div>

            <div class="footer">
                <p>Terminal-to-Web Security System</p>
                <p>Это автоматическое сообщение, не отвечайте на него</p>
            </div>
        </div>
    </body>
    </html>
    `;

    const textContent = `
🖥️ Terminal Web Access - Код доступа

Привет! Запрошен доступ к вашему терминалу через веб-интерфейс.

КОД ДОСТУПА: ${accessCode}

Информация о подключении:
- Время: ${currentTime}
- IP: ${ip || 'Неизвестно'}
- Браузер: ${userAgent || 'Неизвестно'}

⚠️ БЕЗОПАСНОСТЬ:
- Никогда не передавайте этот код третьим лицам
- Код действителен 10 минут
- После использования код становится недействительным

Для доступа: http://localhost:${config.port}

Terminal-to-Web Security System
    `;

    const mailOptions = {
      from: {
        name: 'Terminal Web Access',
        address: config.emailUser,
      },
      to: toEmail,
      subject: `🔐 Код доступа к терминалу - ${accessCode}`,
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
      throw new Error('Не удалось отправить код доступа на email');
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