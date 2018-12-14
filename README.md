# gmailreminder

Send reminders for unanswered emails to a Slack channel.

## Setup

Add

- `email` The email address the reminder is sent for
- `webhook` Slack webhook link
- `reminders` After how many days a reminder should be sent
- Get `project_id`, `client_id` and `client_secret` from Google's developer console. The project needs the `gmail.readonly` scope

Then run

```
yarn
node index.js config.json
```

On the first run, the authentication is done. After that, the credentials are stored.
Now you can call `node index.js config.json` as a cronjob daily at the time you want to send the reminders to Slack.
