const fs = require('fs');
const readline = require('readline');
const fetch = require('node-fetch');
const {google} = require('googleapis');
const path = require('path');
const {OAuth2Client} = require('google-auth-library');

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_DIR =
  (process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE) +
  '/.credentials/';
let TOKEN_PATH = '';
let EMIAL = '';
let WEBHOOK = '';
let REMINDERS = [];
const ONE_DAY = 24 * 60 * 60 * 1000;

if (process.argv.length < 2) {
  console.error('No config specified');
  process.exit(1);
}

// Load client secrets from a local file.
fs.readFile(path.join(__dirname, process.argv[2]), function processClientSecrets(err, content) {
  if (err) {
    console.log('Error loading client secret file: ' + err);
    return;
  }
  // Authorize a client with the loaded credentials, then call the
  // Gmail API.
  authorize(JSON.parse(content), runReminder);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 *
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  EMAIL = credentials.email;
  WEBHOOK = credentials.webhook;
  REMINDERS = credentials.reminders;
  const clientSecret = credentials.installed.client_secret;
  const clientId = credentials.installed.client_id;
  const redirectUrl = credentials.installed.redirect_uris[0];
  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUrl);
  TOKEN_PATH = TOKEN_DIR + EMAIL + '.json';
  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, function(err, token) {
    if (err) {
      getNewToken(oauth2Client, callback);
    } else {
      oauth2Client.credentials = JSON.parse(token);
      callback(oauth2Client);
    }
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 *
 * @param {google.auth.OAuth2} oauth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback to call with the authorized
 *     client.
 */
function getNewToken(oauth2Client, callback) {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url: ', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code from that page here: ', function(code) {
    rl.close();
    oauth2Client.getToken(code, function(err, token) {
      if (err) {
        console.log('Error while trying to retrieve access token', err);
        return;
      }
      oauth2Client.credentials = token;
      storeToken(token);
      callback(oauth2Client);
    });
  });
}

/**
 * Store token to disk be used in later program executions.
 *
 * @param {Object} token The token to store to disk.
 */
function storeToken(token) {
  try {
    fs.mkdirSync(TOKEN_DIR);
  } catch (err) {
    if (err.code != 'EEXIST') {
      throw err;
    }
  }
  fs.writeFile(TOKEN_PATH, JSON.stringify(token));
  console.log('Token stored to ' + TOKEN_PATH);
}

async function runReminder(auth) {
  let threads = await getThreads(auth);
  threads = await Promise.all(threads.map(t => getLastMessage(auth, t.id)));
  threads = threads.filter(isRelevant);
  threads = await Promise.all(threads.map(sendSlackMessage));
  console.log(`Sent ${threads.length} reminder(s) fror ${EMAIL}`);
}

function getThreads(auth) {
  return new Promise((resolve, reject) => {
    const gmail = google.gmail('v1');
    gmail.users.threads.list(
      {
        auth: auth,
        userId: 'me',
        maxResults: 100,
        labelIds: ['INBOX'],
      },
      function(err, response) {
        if (err) {
          reject(err);
        } else {
          resolve(response.data.threads);
        }
      },
    );
  });
}

function getLastMessage(auth, threadID) {
  return new Promise((resolve, reject) => {
    const gmail = google.gmail('v1');
    gmail.users.threads.get(
      {
        auth: auth,
        userId: 'me',
        id: threadID,
      },
      function(err, response) {
        if (err) {
          reject(err);
        } else {
          resolve(response.data);
        }
      },
    );
  });
}

function isRelevant(thread) {
  const lastMessage = thread.messages[thread.messages.length - 1];
  const ago = new Date() - new Date(parseInt(lastMessage.internalDate, 10));
  const isInRelevantDate = REMINDERS.reduce(
    (acc, cv) => acc || (ago < (cv + 1) * ONE_DAY && ago > cv * ONE_DAY),
    false,
  );
  return lastMessage.labelIds.indexOf('SENT') === -1 && isInRelevantDate;
}

function sendSlackMessage(thread) {
  const lastMessage = thread.messages[thread.messages.length - 1];
  const ago = new Date() - new Date(parseInt(lastMessage.internalDate, 10));
  const url = `https://mail.google.com/mail/u/${EMAIL}/#inbox/${
    lastMessage.threadId
  }`;
  const title = getHeaderField(lastMessage, 'subject');
  const author_name = getHeaderField(lastMessage, 'from');
  const age = Math.floor(ago / ONE_DAY);
  const color = age === REMINDERS[0] ? 'warning' : 'danger';

  const body = {
    text: `Folgende E-Mail ist seit ${age} Tag${
      age !== 1 ? 'en' : ''
    } unbeantwortet im Posteingang von ${EMAIL}. Kann bitte jemand die Mail beantworten oder sie archivieren, wenn keine Antwort notwendig ist.`,
    attachments: [
      {
        author_name,
        callback_id: lastMessage.threadId,
        fallback: url,
        title,
        text: lastMessage.snippet,
        color,
        ts: parseInt(lastMessage.internalDate / 1000, 10),
        actions: [
          {
            type: 'button',
            text: 'Öffnen',
            url,
          },
        ],
      },
    ],
  };

  return fetch(WEBHOOK, {
    method: 'POST',
    header: {
      'Content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }).then(res => res.text());
}

function getHeaderField(message, field) {
  const header = message.payload.headers.find(
    ({name, value}) => name.toLowerCase() === field.toLowerCase(),
  );
  return header ? header.value : null;
}
