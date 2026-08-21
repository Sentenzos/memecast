import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MemeCast — мемы прямо на стрим",
  description: "Бесплатные мем-алерты для Twitch: зрители выбирают мем, а он появляется в OBS.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
