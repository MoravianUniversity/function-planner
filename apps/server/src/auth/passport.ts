import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { prisma } from '../lib/prisma.js';
import { appConfig, isEmailDomainAllowed } from '../config.js';

passport.serializeUser((user: Express.User, done) => {
  done(null, user);
});

passport.deserializeUser((user: Express.User, done) => {
  done(null, user);
});

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const callbackURL = process.env.GOOGLE_CALLBACK_URL ?? 'http://localhost:3000/auth/google/callback';

if (clientId && clientSecret) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: clientId,
        clientSecret,
        callbackURL
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error('Google account does not expose an email.'));
          }

          if (!isEmailDomainAllowed(email)) {
            const allowed = appConfig.allowedEmailDomains.join(', ');
            return done(new Error(`Sign-in is limited to these email domains: ${allowed}.`));
          }

          const firstName = profile.name?.givenName || 'Unknown';
          const lastName = profile.name?.familyName || 'Unknown';
          const user = await prisma.user.upsert({
            where: { email },
            update: { googleSub: profile.id, firstName, lastName, enabled: true },
            create: { email, googleSub: profile.id, firstName, lastName }
          });

          return done(null, {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName
          });
        } catch (error) {
          done(error as Error);
        }
      }
    )
  );
}

export default passport;
