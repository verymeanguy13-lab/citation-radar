import './globals.css';
import Providers from './providers';

export const metadata = {
  title: 'CitationRadar',
  description: 'Restaurant health inspection alerts for NYC and Toronto',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}