export const isCourseReadonly = (endsAt: Date | string, now = new Date()): boolean => {
  const date = endsAt instanceof Date ? endsAt : new Date(endsAt);
  return date.getTime() < now.getTime();
};
