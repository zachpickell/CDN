import "./globals.css";

export const metadata = {
  title: "Zach's Drive",
  description: "Private file hosting with shareable links",
};

// Runs before first paint so the saved (or OS-preferred) theme is applied
// without a flash of the wrong one.
const themeInit = `(function(){try{var t=localStorage.getItem('cdn_theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
