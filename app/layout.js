import './globals.css';
import Providers from './providers';
import SiteNav from './site-nav';

export const metadata = {
  title: 'CitationRadar',
  description: 'Restaurant health inspection alerts for NYC and Toronto',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <SiteNav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
