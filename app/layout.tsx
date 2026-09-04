import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RecoverPay — Autonomous B2B Invoice Recovery Agent",
  description: "Hinglish AI reminders, promise-to-pay NLP, Razorpay links, stopping-rule guardrails, audit trail.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-white text-black dark:bg-black dark:text-white antialiased">
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('recoverpay:theme');if(t==='light'){document.documentElement.classList.add('light')}else{document.documentElement.classList.add('dark')}}catch(e){document.documentElement.classList.add('dark')}`,
          }}
        />
      </body>
    </html>
  );
}
