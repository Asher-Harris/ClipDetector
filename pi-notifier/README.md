# Pi SMS Notifier

Send SMS notifications via Twilio. Designed to run on a Raspberry Pi.

## Twilio Setup

1. Sign up at [twilio.com](https://www.twilio.com) (free trial gives $15 credit)
2. From the Twilio Console, get your **Account SID** and **Auth Token**
3. Get a Twilio phone number (free with trial)
4. Verify your personal phone number (required for trial accounts)

## Local Setup

1. Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

2. Run the test script:
   ```bash
   bun run start
   ```

3. You should receive a test SMS on your phone.

## Deploy to Raspberry Pi

1. Build the standalone binary:
   ```bash
   bun run build
   ```

2. Transfer to Pi via SFTP:
   ```bash
   sftp pi@<pi-ip-address>
   put notifier
   put .env
   ```

3. On the Pi, run:
   ```bash
   chmod +x notifier
   ./notifier
   ```
