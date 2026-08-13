export const metadata = {
  title: 'CitationRadar',
  description: 'Restaurant inspection violation alerts for NYC & Toronto',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
