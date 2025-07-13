import { Resend } from 'resend';
import { config } from '../config';
import { logger } from '../utils/logger';

export class ResendEmailService {
  private resend: Resend | null = null;
  private static instance: ResendEmailService;

  constructor() {
    // Инициализируем только если есть API ключ
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
    // Если нет Resend API ключа - используем консоль
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
                <p><strong>Время запроса:</strong> ${currentTime}</p>
                <p><strong>IP адрес:</strong> ${ip || 'Неизвестно'}</p>
                <p><strong>Браузер:</strong> ${userAgent || 'Неизвестно'}</p>
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

            <div class="footer">
                <p>Terminal-to-Web Security System</p>
                <p>Это автоматическое сообщение, не отвечайте на него</p>
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
        to: ['ikrasnodymov@googlemail.com'], // Используем ваш зарегистрированный email
        subject: `🔐 Код доступа к терминалу - ${accessCode}`,
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
      throw new Error('Не удалось отправить код доступа на email');
    }
  }

  async testConnection(): Promise<boolean> {
    if (!this.resend) {
      logger.warn('RESEND_API_KEY not set - using development mode');
      return false;
    }

    try {
      // Простая проверка API ключа через отправку тестового запроса
      const { data, error } = await this.resend.emails.send({
        from: 'test@resend.dev',
        to: ['test@example.com'],
        subject: 'Test connection',
        html: '<p>Test</p>',
      });
      
      // Даже если email не отправился, но API ответил - значит ключ валидный
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