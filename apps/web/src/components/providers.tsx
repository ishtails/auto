"use client";

import { env } from "@auto/env/web";
import { Toaster } from "@auto/ui/components/sonner";
import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { queryClient } from "@/utils/orpc";
import { ThemeProvider } from "./theme-provider";

export default function Providers({ children }: { children: React.ReactNode }) {
	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="system"
			disableTransitionOnChange
			enableSystem
		>
			<PrivyProvider
				appId={env.NEXT_PUBLIC_PRIVY_APP_ID}
				config={{
					appearance: {
						theme: "dark",
						accentColor: "#676FFF",
					},
					embeddedWallets: {
						ethereum: {
							createOnLogin: "users-without-wallets",
						},
					},
				}}
			>
				<QueryClientProvider client={queryClient}>
					{children}
					<ReactQueryDevtools />
				</QueryClientProvider>
			</PrivyProvider>
			<Toaster richColors />
		</ThemeProvider>
	);
}
