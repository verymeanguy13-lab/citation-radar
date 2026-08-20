// CitationRadar -- NextAuth configuration (Session 8)
//
// Credentials (email/password) plus Google OAuth. Google accounts skip
// the signup form entirely, so they land with no buyer_category --
// the dashboard prompts a one-time "complete your profile" step for
// those users (see app/complete-profile). Google-verified emails are
// trusted as already verified; no separate verification email needed.

import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';
import { pool } from './db';

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const { rows } = await pool.query(
          'SELECT id, email, password_hash, business_name FROM users WHERE email = $1',
          [credentials.email]
        );
        const user = rows[0];
        if (!user || !user.password_hash) return null;
        const valid = await bcrypt.compare(credentials.password, user.password_hash);
        if (!valid) return null;
        return { id: String(user.id), email: user.email, name: user.business_name };
      },
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === 'google') {
        const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [user.email]);
        if (rows.length === 0) {
          // First time seeing this Google account -- create a user row with
          // no password (they'll never use Credentials sign-in) and no
          // buyer_category yet (collected via /complete-profile instead).
          await pool.query(
            'INSERT INTO users (email, business_name, email_verified) VALUES ($1, $2, TRUE)',
            [user.email, profile?.name || user.email]
          );
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [user.email]);
        token.id = rows[0]?.id;
      }
      if (token.id) {
        const { rows } = await pool.query(
          'SELECT email_verified, business_name, buyer_category, is_admin, plan FROM users WHERE id = $1',
          [token.id]
        );
        token.emailVerified = rows[0]?.email_verified ?? false;
        token.businessName = rows[0]?.business_name;
        token.buyerCategory = rows[0]?.buyer_category;
        token.isAdmin = rows[0]?.is_admin ?? false;
        token.plan = rows[0]?.plan ?? 'free';
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.emailVerified = token.emailVerified;
        session.user.name = token.businessName;
        session.user.buyerCategory = token.buyerCategory;
        session.user.isAdmin = token.isAdmin;
        session.user.plan = token.plan;
      }
      return session;
    },
  },
};