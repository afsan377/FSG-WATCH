// ==========================
// FSG WATCHER - Part 1
// ==========================

const { Client, GatewayIntentBits, Partials, EmbedBuilder, PermissionsBitField, REST, Routes, SlashCommandBuilder } = require("discord.js");
const mongoose = require("mongoose");
const ms = require("ms");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// ---------------- CONFIG ----------------
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || "";
const OWNER_ROLE_ID = process.env.OWNER_ROLE_ID || "";
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || "";
const MOD_ROLE_ID = process.env.MOD_ROLE_ID || "";
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || "";
const MUTE_ROLE_ID = process.env.MUTE_ROLE_ID || "";
const BANLOG_CHANNEL = process.env.BANLOG_CHANNEL || "";
const MESSAGELOG_CHANNEL = process.env.MESSAGELOG_CHANNEL || "";
const GIVEAWAY_CHANNELS = process.env.GIVEAWAY_CHANNELS ? process.env.GIVEAWAY_CHANNELS.split(",") : [];

// ---------------- MONGODB ----------------
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("✅ MongoDB connected"))
    .catch(console.error);
}

// ---------------- JSON STORAGE ----------------
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, file + ".json")));
  } catch {
    return {};
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(path.join(dataDir, file + ".json"), JSON.stringify(data, null, 2));
}

let messageCounts = readJSON("messages");

// ---------------- SCHEMAS ----------------
let GiveawayModel = null;
let WarningModel = null;

if (process.env.MONGODB_URI) {
  const gSchema = new mongoose.Schema({
    messageId: String,
    channelId: String,
    prize: String,
    winners: Number,
    endsAt: Date,
    hostId: String,
    roleRequired: String,
    extraRole: String,
  });
  GiveawayModel = mongoose.models.Giveaway || mongoose.model("Giveaway", gSchema);

  const wSchema = new mongoose.Schema({
    guildId: String,
    userId: String,
    modId: String,
    reason: String,
    timestamp: Date,
  });
  WarningModel = mongoose.models.Warning || mongoose.model("Warning", wSchema);
}

// ---------------- CLIENT ----------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// ---------------- HELPERS ----------------
function hasRole(member, role) { return role && member && member.roles.cache.has(role); }
function isOwner(member) { return hasRole(member, OWNER_ROLE_ID); }
function isAdmin(member) { return member.permissions.has(PermissionsBitField.Flags.Administrator) || hasRole(member, ADMIN_ROLE_ID); }
function isMod(member) { return isAdmin(member) || hasRole(member, MOD_ROLE_ID); }
function isStaff(member) { return isMod(member) || hasRole(member, STAFF_ROLE_ID); }

async function sendLog(channelId, content) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel) await channel.send(content);
  } catch {}
}

function pickWinners(users, count) {
  const pool = Array.from(users);
  const winners = [];
  while (winners.length < count && pool.length) {
    winners.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return winners;
}
// ---------------- REGISTER SLASH COMMANDS ----------------
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName("ping").setDescription("Check bot latency"),

    new SlashCommandBuilder()
      .setName("gstart")
      .setDescription("Start a giveaway")
      .addStringOption(o => o.setName("duration").setDescription("Duration e.g. 1h").setRequired(true))
      .addIntegerOption(o => o.setName("winners").setDescription("Number of winners").setRequired(true))
      .addStringOption(o => o.setName("prize").setDescription("Prize").setRequired(true))
      .addRoleOption(o => o.setName("role_required").setDescription("Role required to enter"))
      .addRoleOption(o => o.setName("extra_entries").setDescription("Role for extra entries")),

    new SlashCommandBuilder()
      .setName("ban")
      .setDescription("Ban a user")
      .addUserOption(o => o.setName("user").setDescription("User to ban").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason")),

    new SlashCommandBuilder()
      .setName("kick")
      .setDescription("Kick a user")
      .addUserOption(o => o.setName("user").setDescription("User to kick").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason")),

    new SlashCommandBuilder()
      .setName("mute")
      .setDescription("Mute a user")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
      .addStringOption(o => o.setName("duration").setDescription("Duration e.g. 10m"))
      .addStringOption(o => o.setName("reason").setDescription("Reason")),

    new SlashCommandBuilder()
      .setName("unmute")
      .setDescription("Unmute a user")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

    new SlashCommandBuilder()
      .setName("warn")
      .setDescription("Warn a user")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true)),

    new SlashCommandBuilder()
      .setName("lock")
      .setDescription("Lock the current channel"),

    new SlashCommandBuilder()
      .setName("unlock")
      .setDescription("Unlock the current channel"),

    new SlashCommandBuilder()
      .setName("msgcount")
      .setDescription("Show message count")
      .addUserOption(o => o.setName("user").setDescription("User")),

    new SlashCommandBuilder()
      .setName("leaderboard")
      .setDescription("Show top message senders"),

    new SlashCommandBuilder()
      .setName("addrole")
      .setDescription("Add a role to a user")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
      .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)),

    new SlashCommandBuilder()
      .setName("removerole")
      .setDescription("Remove a role from a user")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
      .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)),

    new SlashCommandBuilder()
      .setName("createrole")
      .setDescription("Create a new role")
      .addStringOption(o => o.setName("name").setDescription("Role name").setRequired(true))
      .addStringOption(o => o.setName("color").setDescription("Hex color for role"))
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    }
    console.log("✅ Slash commands registered");
  } catch (err) {
    console.error(err);
  }
}

// ---------------- READY EVENT ----------------
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setActivity("FSG WATCHER", { type: 2 });
  await registerCommands();
});
// ---------------- SLASH COMMAND HANDLER ----------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, options, guild, member, channel } = interaction;

  // PING
  if (commandName === "ping") {
    return interaction.reply(`🏓 Pong! Latency: ${client.ws.ping}ms`);
  }

  // BAN
  if (commandName === "ban") {
    if (!member.permissions.has(PermissionsBitField.Flags.BanMembers))
      return interaction.reply({ content: "❌ You lack permission to ban.", ephemeral: true });

    const user = options.getUser("user");
    const reason = options.getString("reason") || "No reason provided";
    const target = guild.members.cache.get(user.id);

    if (!target) return interaction.reply("User not found.");
    await target.ban({ reason });
    return interaction.reply(`✅ Banned **${user.tag}** | Reason: ${reason}`);
  }

  // KICK
  if (commandName === "kick") {
    if (!member.permissions.has(PermissionsBitField.Flags.KickMembers))
      return interaction.reply({ content: "❌ You lack permission to kick.", ephemeral: true });

    const user = options.getUser("user");
    const reason = options.getString("reason") || "No reason provided";
    const target = guild.members.cache.get(user.id);

    if (!target) return interaction.reply("User not found.");
    await target.kick(reason);
    return interaction.reply(`✅ Kicked **${user.tag}** | Reason: ${reason}`);
  }

  // MUTE
  if (commandName === "mute") {
    if (!member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return interaction.reply({ content: "❌ You can’t mute users.", ephemeral: true });

    const user = options.getUser("user");
    const duration = options.getString("duration") || "10m";
    const reason = options.getString("reason") || "No reason";
    const msDuration = ms(duration);

    if (!msDuration) return interaction.reply("❌ Invalid duration.");

    const target = guild.members.cache.get(user.id);
    if (!target) return interaction.reply("User not found.");

    await target.timeout(msDuration, reason);
    return interaction.reply(`🔇 Muted **${user.tag}** for ${duration}. Reason: ${reason}`);
  }

  // UNMUTE
  if (commandName === "unmute") {
    if (!member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return interaction.reply({ content: "❌ You can’t unmute users.", ephemeral: true });

    const user = options.getUser("user");
    const target = guild.members.cache.get(user.id);

    if (!target) return interaction.reply("User not found.");

    await target.timeout(null);
    return interaction.reply(`🔊 Unmuted **${user.tag}**`);
  }

  // WARN
  if (commandName === "warn") {
    const user = options.getUser("user");
    const reason = options.getString("reason");
    const target = guild.members.cache.get(user.id);

    if (!target) return interaction.reply("User not found.");

    await interaction.reply(`⚠️ Warned **${user.tag}** | Reason: ${reason}`);
  }

  // LOCK
  if (commandName === "lock") {
    if (!member.permissions.has(PermissionsBitField.Flags.ManageChannels))
      return interaction.reply({ content: "❌ No permission to lock.", ephemeral: true });

    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
    return interaction.reply("🔒 Channel locked.");
  }

  // UNLOCK
  if (commandName === "unlock") {
    if (!member.permissions.has(PermissionsBitField.Flags.ManageChannels))
      return interaction.reply({ content: "❌ No permission to unlock.", ephemeral: true });

    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: true });
    return interaction.reply("🔓 Channel unlocked.");
  }

  // GIVEAWAY START
  if (commandName === "gstart") {
    const duration = options.getString("duration");
    const winners = options.getInteger("winners");
    const prize = options.getString("prize");
    const roleRequired = options.getRole("role_required");

    const endTime = Date.now() + ms(duration);
    const embed = new EmbedBuilder()
      .setTitle("🎉 Giveaway Started!")
      .setDescription(`Prize: **${prize}**\nDuration: **${duration}**\nWinners: **${winners}**`)
      .setColor("Random")
      .setFooter({ text: `Ends at` })
      .setTimestamp(endTime);

    const msg = await interaction.reply({ embeds: [embed], fetchReply: true });
    await msg.react("🎉");

    setTimeout(async () => {
      const fetchedMsg = await channel.messages.fetch(msg.id);
      const reactions = fetchedMsg.reactions.cache.get("🎉");
      const users = await reactions.users.fetch();
      const entries = users.filter(u => !u.bot && (!roleRequired || guild.members.cache.get(u.id).roles.cache.has(roleRequired.id)));

      const winnerList = entries.random(winners);
      const winnersText = winnerList.length ? winnerList.map(u => u.toString()).join(", ") : "No valid winners.";

      channel.send(`🎊 **Giveaway Ended!**\nPrize: **${prize}**\nWinners: ${winnersText}`);
    }, ms(duration));
  }
});
// ---------------- MONGODB + XP SYSTEM ----------------
mongoose.connect(process.env.MONGO_URL || "", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log("✅ MongoDB connected"))
.catch((err) => console.error("❌ MongoDB error:", err));

const xpSchema = new mongoose.Schema({
  userId: String,
  guildId: String,
  xp: Number,
  level: Number,
});
const XP = mongoose.model("XP", xpSchema);

// ---------------- MESSAGE XP TRACKER ----------------
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const randomXP = Math.floor(Math.random() * 15) + 5;
  const data = await XP.findOne({ userId: message.author.id, guildId: message.guild.id }) || new XP({
    userId: message.author.id,
    guildId: message.guild.id,
    xp: 0,
    level: 0,
  });

  data.xp += randomXP;
  const nextLevel = 100 * (data.level + 1);

  if (data.xp >= nextLevel) {
    data.level++;
    data.xp -= nextLevel;
    message.channel.send(`🎉 Congrats ${message.author}, you leveled up to **${data.level}**!`);
  }

  await data.save();
});

// ---------------- LEADERBOARD COMMAND ----------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;
  const { commandName, guild } = interaction;

  if (commandName === "leaderboard") {
    const top = await XP.find({ guildId: guild.id }).sort({ level: -1, xp: -1 }).limit(10);
    if (!top.length) return interaction.reply("❌ No data yet.");

    const desc = top
      .map((u, i) => `**${i + 1}.** <@${u.userId}> — Level: ${u.level} (${u.xp} XP)`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle("🏆 XP Leaderboard")
      .setDescription(desc)
      .setColor("Gold");

    return interaction.reply({ embeds: [embed] });
  }
});

// ---------------- ROLE AUTO ASSIGN ----------------
client.on("guildMemberAdd", (member) => {
  const autoRoleId = process.env.AUTO_ROLE_ID; // optional
  if (autoRoleId) {
    member.roles.add(autoRoleId).catch(() => {});
  }
});

// ---------------- LOGS ----------------
client.on("messageDelete", (msg) => {
  const logChannel = msg.guild.channels.cache.find(c => c.name === "message-logs");
  if (!logChannel) return;
  const embed = new EmbedBuilder()
    .setTitle("🗑️ Message Deleted")
    .addFields({ name: "Author", value: msg.author ? msg.author.tag : "Unknown" })
    .addFields({ name: "Content", value: msg.content || "No content" })
    .setColor("Red")
    .setTimestamp();
  logChannel.send({ embeds: [embed] });
});

// ---------------- KEEP ALIVE SERVER ----------------
const app = express();
app.get("/", (req, res) => res.send("Bot is alive!"));
app.listen(3000, () => console.log("🌐 Uptime server running on port 3000"));
