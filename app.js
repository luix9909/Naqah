const express = require('express');
const Discord = require('discord.js');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const session = require('express-session');
const dotenv = require('dotenv');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

dotenv.config();

const app = express();
const adapter = new FileSync('db.json');
const db = low(adapter);
db.defaults({ guilds: {}, users: {} }).write();

const client = new Discord.Client({
  intents: [
    Discord.GatewayIntentBits.Guilds,
    Discord.GatewayIntentBits.GuildMessages,
    Discord.GatewayIntentBits.MessageContent,
    Discord.GatewayIntentBits.GuildMembers
  ]
});

client.on('ready', () => {
  console.log(`Bot online as ${client.user.tag}`);
  client.user.setActivity('Working on your love servers ♥', { type: Discord.ActivityType.Playing });
});

// Bot features
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const guildId = message.guild.id;
  const settings = db.get(`guilds.${guildId}`).value() || {};

  // Auto-reply
  if (settings.autoReplyEnabled && settings.autoReplyText) {
    message.reply(settings.autoReplyText);
  }

  // Basic moderation (delete if spam keyword)
  if (settings.moderationEnabled && message.content.includes('spam')) {
    message.delete();
    message.author.send('Your message was deleted for spam.');
  }

  // Earn credits: +1 per message
  const userId = message.author.id;
  db.update(`users.${userId}.credits`, n => (n || 0) + 1).write();
});

client.login(process.env.BOT_TOKEN);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: '/auth/discord/callback',
  scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
  profile.accessToken = accessToken;
  return done(null, profile);
}));

app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());
app.set('view engine', 'ejs');

const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&permissions=8&scope=bot`;

app.get('/', (req, res) => {
  res.render('login');
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => {
  res.redirect('/dashboard');
});

app.get('/dashboard', async (req, res) => {
  if (!req.user) return res.redirect('/');
  const userGuilds = req.user.guilds.filter(g => (g.permissions & 0x8) === 0x8); // Administrator perm
  const botGuildIds = Array.from(client.guilds.cache.keys());
  const sharedGuilds = userGuilds.filter(g => botGuildIds.includes(g.id));
  const credits = db.get(`users.${req.user.id}.credits`).value() || 0;
  const currentTime = new Date().toLocaleTimeString();
  res.render('dashboard', { user: req.user, guilds: sharedGuilds, credits, currentTime, inviteUrl });
});

app.get('/server/:id', (req, res) => {
  if (!req.user) return res.redirect('/');
  const guildId = req.params.id;
  // Basic check (improve for production)
  if (!req.user.guilds.find(g => g.id === guildId && (g.permissions & 0x8) === 0x8)) return res.redirect('/dashboard');
  const settings = db.get(`guilds.${guildId}`).value() || {};
  res.render('server', { settings, guildId });
});

app.post('/server/:id', (req, res) => {
  const guildId = req.params.id;
  db.set(`guilds.${guildId}`, {
    autoReplyEnabled: req.body.autoReplyEnabled === 'on',
    autoReplyText: req.body.autoReplyText,
    moderationEnabled: req.body.moderationEnabled === 'on'
  }).write();
  res.redirect(`/server/${guildId}`);
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
