import { DurableObject } from "cloudflare:workers";
import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

const ERROR_INTERVAL = 30; // 30 minutes
const ERROR_THRESHOLD = 1000; // 1000 errors

export class MonitorDurableObject extends DurableObject<Env> {
    private sending = false;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);

        ctx.blockConcurrencyWhile(async () => {
            if (await ctx.storage.getAlarm() == null) {
                ctx.storage.setAlarm(Date.now() + 1000 * 60 * ERROR_INTERVAL);
            }
        })
    }

    public async bumpErrorCount() {
        try {
            const errorCount = await this.ctx.storage.get<number>('errorCount') || 0

            if (errorCount >= ERROR_THRESHOLD) {
                await this.sendNotification();
            } else {
                await this.ctx.storage.put('errorCount', errorCount + 1)
            }
        } catch (err) {
            console.error('MONITOR', err);
        }
    }
    private async resetErrorCount() {
        await this.ctx.storage.put('errorCount', 0)
    }
    private async sendNotification() {
        if (this.sending) {
            return;
        }

        try {
            this.sending = true;

            const msg = createMimeMessage();

            msg.setSender({ name: "Launchtube Notifications", addr: "noreply@launchtube.xyz" });
            msg.setRecipient("tyler@stellar.org");
            msg.setSubject("High Error Count Detected");
            msg.addMessage({
                contentType: 'text/plain',
                data: `
                    Launchtube has detected a high error count. ${ERROR_THRESHOLD} in ${ERROR_INTERVAL} minutes. Please check the logs for more information.
                    https://dash.cloudflare.com/ba55b7ae9acfb3ed152103e3497c0752/workers/services/view/launchtube-prod/production/observability/logs?needle=%7B%22value%22%3A%22%22%2C%22isRegex%22%3Afalse%2C%22matchCase%22%3Afalse%7D&filters=%5B%7B%22key%22%3A%22%24metadata.error%22%2C%22operation%22%3A%22exists%22%2C%22type%22%3A%22string%22%2C%22id%22%3A%22oigq94dh0b%22%7D%5D&view=events&time=%7B%22value%22%3A1%2C%22unit%22%3A%22hours%22%2C%22type%22%3A%22relative%22%7D 
                `,
            });

            let message = new EmailMessage(
                "noreply@launchtube.xyz",
                "tyler@stellar.org",
                msg.asRaw()
            );
                
            await this.env.EMAIL.send(message);
            await this.alarm();
        } finally {
            this.sending = false;   
        }
    }

    async alarm(info?: AlarmInvocationInfo) {
        await this.resetErrorCount();
        await this.ctx.storage.setAlarm(Date.now() + 1000 * 60 * ERROR_INTERVAL);
    }
}