import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { prisma } from '../src/lib/prisma.js';

interface Info {
  firstName: string;
  lastName: string;
  email: string;
  courseName: string;
  courseTerm: string;
  courseStartsAt: string;
  courseEndsAt: string;
}

const emailPattern = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

async function promptForInstructorAndCourseInfo(): Promise<Info> {
  const rl = createInterface({ input, output });

  try {
    const firstName = (await rl.question('Initial instructor first name (default: Ada): ')).trim() || 'Ada';
    const lastName = (await rl.question('Initial instructor last name (default: Instructor): ')).trim() || 'Instructor';

    let email = '';
    while (!emailPattern.test(email)) {
      const raw = (await rl.question('Initial instructor email (required): ')).trim().toLowerCase();
      if (!raw) {
        console.log('Email is required.');
        continue;
      }
      if (!emailPattern.test(raw)) {
        console.log('Please enter a valid email address.');
        continue;
      }
      email = raw;
    }

    const courseName = (await rl.question('Initial course name (default: Default Course): ')).trim() || 'Default Course';
    const courseTerm = (await rl.question('Initial course term (default: Default Term): ')).trim() || 'Default Term';
    const currentDate = new Date();
    const defaultCourseStartsAt = currentDate.toISOString();
    const defaultCourseEndsAt = new Date(currentDate.getTime() + 120 * 24 * 60 * 60 * 1000).toISOString();
    const courseStartsAt = (await rl.question(`Initial course starts at (default: ${defaultCourseStartsAt}): `)).trim() || defaultCourseStartsAt;
    const courseEndsAt = (await rl.question(`Initial course ends at (default: ${defaultCourseEndsAt}): `)).trim() || defaultCourseEndsAt;

    return { firstName, lastName, email, courseName, courseTerm, courseStartsAt, courseEndsAt };
  } finally {
    rl.close();
  }
}

async function main() {
  const info = await promptForInstructorAndCourseInfo();

  const instructor = await prisma.user.upsert({
    where: { email: info.email },
    update: {
      firstName: info.firstName,
      lastName: info.lastName,
      enabled: true
    },
    create: {
      email: info.email,
      firstName: info.firstName,
      lastName: info.lastName,
      enabled: true
    }
  });

  const course = await prisma.course.create({
    data: {
      name: info.courseName,
      term: info.courseTerm,
      startsAt: new Date(info.courseStartsAt),
      endsAt: new Date(info.courseEndsAt)
    }
  });

  await prisma.enrollment.createMany({
    data: [
      { userId: instructor.id, courseId: course.id, role: 'INSTRUCTOR' },
    ],
    skipDuplicates: true
  });

  console.log(`Seed complete. Instructor ${instructor.email} is enrolled as INSTRUCTOR in course ${course.name} (${course.term}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
