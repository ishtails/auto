import type { Metadata } from "next";
import { Manrope, Newsreader } from "next/font/google";

import "../index.css";
import Providers from "@/components/providers";

const newsreader = Newsreader({
	variable: "--font-newsreader",
	subsets: ["latin"],
	weight: ["400", "500", "600"],
});

const manrope = Manrope({
	variable: "--font-manrope",
	subsets: ["latin"],
	weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
	title: "vault.eth",
	description: "Autonomous trading vault control surface",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html
			className={`${manrope.className} ${newsreader.variable} ${manrope.variable}`}
			lang="en"
			suppressHydrationWarning
		>
			<body className="antialiased">
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
