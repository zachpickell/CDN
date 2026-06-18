import "./globals.css";

export const metadata = {
  title: "Zach's Drive",
  description: "Private file hosting with shareable links",
  icon: "/icon.png",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
