import Script from "next/script";

// Microsoft Clarity: session recordings, heatmaps and per-person usage.
// Loads only when CLARITY_PROJECT_ID is set (Railway variable), so local dev stays untracked.
// `user` ties each session to the signed-in person, so Clarity can filter recordings by who used the tool.
// `tags` become Clarity custom tags (filterable in the dashboard).
export default function Clarity({ user, tags = {} }) {
  const projectId = process.env.CLARITY_PROJECT_ID;
  if (!projectId || !/^[a-z0-9]+$/i.test(projectId)) return null;
  // JSON-encode and escape "<" so no value can break out of the script tag.
  const js = (v) => JSON.stringify(v ?? null).replace(/</g, "\\u003c");
  const lines = [
    `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script",${js(projectId)});`,
  ];
  if (user?.id) {
    lines.push(`window.clarity("identify",${js(String(user.id))},null,null,${js(user.name || String(user.id))});`);
    lines.push(`window.clarity("set","user",${js(user.name || String(user.id))});`);
  }
  for (const [k, v] of Object.entries(tags)) {
    if (v != null && v !== "") lines.push(`window.clarity("set",${js(k)},${js(String(v))});`);
  }
  return (
    <Script id="ms-clarity" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: lines.join("\n") }} />
  );
}
