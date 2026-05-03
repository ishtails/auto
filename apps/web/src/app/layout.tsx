import type { Metadata } from "next";
import { Manrope, Newsreader } from "next/font/google";

import "../index.css";
import Providers from "@/components/providers";
import { Topbar } from "@/components/topbar";

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
	metadataBase: new URL(
		process.env.VERCEL_URL
			? `https://${process.env.VERCEL_URL}`
			: "http://localhost:3000"
	),
	title: {
		default: "auto.eth",
		template: "%s · auto.eth",
	},
	description:
		"Autonomous fund manager orchestration — create, run, and verify agent vaults.",
	applicationName: "auto.eth",
	icons: {
		icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
	},
	openGraph: {
		type: "website",
		siteName: "auto.eth",
		title: "auto.eth",
		description:
			"Autonomous fund manager orchestration — create, run, and verify agent vaults.",
	},
	twitter: {
		card: "summary_large_image",
		title: "auto.eth",
		description:
			"Autonomous fund manager orchestration — create, run, and verify agent vaults.",
	},
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
				<Providers>
					<Topbar />
					{children}
				</Providers>
			</body>
		</html>
	);
}
