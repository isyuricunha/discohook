import { writeFile } from "node:fs/promises";

// This is kind of silly but this data is easier to maintain with
// types and formatting. Just requires an extra build step.

/** @type {Record<string, Record<string, string | import('discord-api-types/v10').APIEmbed>>} */
const data = {
  en: {
    send: {
      title: "How do I send messages?",
      description: [
        "To send a message, you must first obtain a Webhook URL. You can get one using the [Discohook Utils bot](https://discohook.app/bot) with the **/webhook create** command, or you can create one manually in the channel settings.",
        "",
        "Once you have copied the Webhook URL you can paste it at the top of Discohook's editor, and press the **Send** button to have it appear in your server!",
      ].join("\n"),
    },
    edit: {
      title: "How do I edit messages?",
      description:
        "This process is easier with [our official bot](https://discohook.app/bot), but it's not necessary.",
      fields: [
        {
          name: "If you have Discohook Utils",
          value: [
            "1. Right click or long press on the message to edit, then open the Apps menu and select **Restore**.",
            ' - If it\'s a webhook message that can be edited, the bot will prompt you to "include edit options". This changes whether the webhook and message link will be pre-filled and makes it easier to get right into editing.',
            ' - You can also do this with the </restore:1> command (choose "With edit options" for the `mode` option).',
            "2. The bot will reply with a link, which when opened will have the Discord message opened right up in the Discohook editor!",
          ].join("\n"),
          inline: false,
        },
        {
          name: "The process on the Discohook website",
          value: [
            '1. Right click or long press on the message to edit, then select "Copy Message Link".',
            '2. In Discohook, scroll down to the bottom of the website. Click the "Settings" button, then choose "Set Reference". Paste the copied message link in the box.',
            "3. Select the webhook that sent the message or add it in the \"Add Webhook\" menu. If you're not logged in, you may have to copy the webhook URL using Discohook Utils's </webhook info:1> command.",
            '4. If you would like to overwrite the current message that you see in the editor, choose "Overwrite Editor". This will pull the message data from Discord and put it into Discohook so you can edit it. Otherwise, choose "Set Reference".',
          ].join("\n"),
          inline: false,
        },
      ],
    },
    sidebar: {
      title: "How do I remove the sidebar color on an embed?",
      description:
        'In the "Sidebar Color" option, select one of the last two preset options depending on the theme you\'re using.',
    },
    mention: {
      title: "How do I mention a member, role, channel, or emoji?",
      description: [
        "The [Discohook Utils bot](https://discohook.app/bot) offers helper commands for formatting mentions.",
        "",
        "Members & roles: **/format mention**",
        "Channels & threads: **/format channel**",
        "Emojis: **/format emoji**",
        "",
        'Keep in mind that mentions don\'t send notifications in embeds, if you want this to happen you must use the "Content" field. Mentions in embeds may also fail to show up properly, especially on mobile devices, due to the way Discord loads mentions.',
      ].join("\n"),
    },
    ping: "mention",
    user: "mention",
    member: "mention",
    role: "mention",
    channel: "mention",
    emoji: "mention",
    link: {
      title: "How do I create links?",
      description:
        "To create a hyperlink, use the following markdown syntax: `[text](url)`. As an example `[Discohook](https://discohook.app)` turns into [Discohook](https://discohook.app)!",
      fields: [
        {
          name: "Troubleshooting",
          value: [
            "- Make sure there is not a space between the [text] and (url) parts, as Discord won't understand that.",
            '- This syntax does not work in the following embed sections: title, author name, field title, footer. For titles and authors, you can press "Add URL" to hyperlink the entire value.',
          ].join("\n"),
        },
      ],
    },
    hyperlink: "link",
    // markdown: {
    //   title: "How do I use markdown?",
    //   description:
    //     "[Expanded version (PDF)](https://assets.discohook.app/discord_md_cheatsheet.pdf)",
    //   image: { url: "https://assets.discohook.app/discord_md_cheatsheet.png" },
    // },
    // formatting: "markdown",
    blocked: {
      title: "My request to Discord was blocked, what do I do?",
      description:
        'The most common cause of this is a privacy extension like Privacy Badger blocking requests to Discord, which is a 3rd-party host. If you have an extension like this, allow Discord\'s domains or simply disable it for Discohook. Anything to the right of "block entirely" for `discord.com` is enough.',
      image: {
        url: "https://discohook.app/help/privacy_badger.png",
      },
    },
    nothing: {
      title: "I set up my webhook, but clicking send does nothing.",
      description:
        'This is probably because your browser wasn\'t able to connect to Discord. Try restarting your browser or using private ("incognito") mode.',
    },
    image: {
      title: "My images don't load properly.",
      description:
        "Make sure the URL you used for the image is a direct and non-expiring image URL. It may have happened that you copied a link to a webpage that contains the image, instead of the image itself. Discord attachment links also expire after some time, which may cause issues if you use mistakenly an expired one while editing.\n\nIf done properly, the image should appear in the preview and send to Discord without issues.",
    },
    buttons: {
      title: "How do I add buttons to my messages/embeds?",
      description:
        'Use the `/buttons` command or the "Buttons & Components" message command to add buttons to your messages. Messages must be sent by a webhook that this bot created in order for this to work. To get a webhook like this, use `/webhook create`.\n\n[Here\'s an example of the "Buttons & Components" message command](https://www.youtube.com/watch?v=tGQsZaIGr2A&list=PL2lbsZZaSX2heZ_bGhkJ3WJHm9PijiXWv)',
    },
    "reaction role": {
      title: "How do I make reaction roles?",
      description:
        "To create a reaction role, [invite the Discohook Utils bot](https://discohook.app/bot) use the **/reaction-role create** command.\n\nIt expects you put in a message link to the message you want the reaction role on, the emoji you want to use, and the role you want it to give.\n\nOnce the command is run, the reaction role should be functioning, though you may have issues with permissions. To make sure reaction roles work in your server you can verify the setup using **/reaction-role verify**.",
      fields: [
        {
          name: "If you are currently using Discobot for this",
          value:
            "Invite the above bot instead so that your reaction roles continue working. Read more about this [here](https://discohook.app/guide/deprecated/migrate-utils).",
        },
      ],
    },
    rr: "reaction role",
    schedule: {
      title: "How do I schedule a message to be sent later?",
      description: [
        "- First, create a backup by clicking **Backups** on the main page, typing in a name, then pressing **Create Backup**.",
        "- Click the pencil icon on the backup you just created (you can also do this on your [user page](https://discohook.app/me/backups)).",
        "- Configure your schedule in the menu that appears.",
        '- Click "Save"',
        "",
        'To remove a schedule, simply uncheck the "Schedule this backup" box, then save.',
      ].join("\n"),
    },
  },
};

await writeFile(
  new URL("../public/help/en.json", import.meta.url).pathname,
  JSON.stringify(data.en),
);
