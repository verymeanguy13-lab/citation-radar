// CitationRadar -- NextAuth configuration (Session 8)
//
// Email/password via Credentials provider. The jwt callback re-reads
// email_verified from the database on every request (not just at
// sign-in) so the dashboard's verification banner disappears right
// after clicking the email link, without needing to log out and back in.

import CredentialsProvider from 'next-auth/providers/credentials';
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
  ],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      if (token.id) {
        const { rows } = await pool.query('SELECT email_verified FROM users WHERE id = $1', [token.id]);
        token.emailVerified = rows[0]?.email_verified ?? false;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.emailVerified = token.emailVerified;
      }
      return session;
    },
  },
};