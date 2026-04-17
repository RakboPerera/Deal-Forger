// Simple in-process async job queue
const jobs = new Map();

export function createJob(id, metadata = {}) {
  const job = {
    id,
    status: 'pending',
    progress: 0,
    stage: '',
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    ...metadata
  };
  jobs.set(id, job);
  return job;
}

export function updateJob(id, updates) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, updates);
  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export function getAllJobs() {
  return Array.from(jobs.values());
}

export async function runJob(id, asyncFn) {
  const job = jobs.get(id);
  if (!job) throw new Error(`Job ${id} not found`);

  job.status = 'running';
  job.startedAt = new Date().toISOString();

  try {
    const result = await asyncFn((progress, stage) => {
      job.progress = progress;
      if (stage) job.stage = stage;
    });
    job.status = 'completed';
    job.progress = 100;
    job.result = result;
    job.completedAt = new Date().toISOString();
    return result;
  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
    job.completedAt = new Date().toISOString();
    throw err;
  }
}
