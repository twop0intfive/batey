const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

const NOTES_DIR = path.join(__dirname, "../src/site/notes");
const OUTPUT_PATH = path.join(__dirname, "../dist/feed.xml");
const SITE_URL = "https://elbatey.twop0intfive.xyz";

const entries = [];

fs.readdirSync(NOTES_DIR).forEach((file) => {
  if (file.endsWith(".md")) {
    const fullPath = path.join(NOTES_DIR, file);
    const fileContent = fs.readFileSync(fullPath, "utf8");
    const { data, content } = matter(fileContent);

    const slug = file.replace(/\.md$/, "");
    const title = data.title || slug;

    if (!data.date) {
      console.warn(`⚠️ Skipping "${file}" — missing date in frontmatter.`);
      return;
    }

    entries.push({
      title,
      date: new Date(data.date).toISOString(),
      url: `${SITE_URL}/en/notes/${slug}/`,
      summary: content.substring(0, 140).replace(/[\r\n]+/g, " ").trim()
    });
  }
});

entries.sort((a, b) => new Date(b.date) - new Date(a.date));

const updated = entries.length > 0 ? entries[0].date : new Date().toISOString();

let feed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>el batey | twop0intfive.xyz</title>
  <link href="${SITE_URL}/feed.xml" rel="self" />
  <updated>${updated}</updated>
  <id>${SITE_URL}</id>
`;

entries.forEach((entry) => {
  feed += `
  <entry>
    <title>${entry.title}</title>
    <link href="${entry.url}" />
    <id>${entry.url}</id>
    <updated>${entry.date}</updated>
    <summary>${entry.summary}</summary>
  </entry>`;
});

feed += `\n</feed>`;

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, feed);

console.log(`✅ RSS feed written to ${OUTPUT_PATH}`);
