export type TaskCreateArgs = {
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high" | "critical";
  status?: "todo" | "in_progress" | "review" | "done" | "cancelled";
  projectId?: string;
  dueDate?: string;
};

export type TaskDeleteArgs = {
  id: string;
};

export type TaskUpdateArgs = {
  id: string;
  status?: "todo" | "in_progress" | "review" | "done" | "cancelled";
  priority?: "low" | "medium" | "high" | "critical";
  title?: string;
  dueDate?: string;
};

export type LeadCreateArgs = {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  source?: string;
  estimatedValue?: number;
  notes?: string;
};

export type LeadUpdateArgs = {
  id?: string;
  name?: string;
  status?: "new" | "contacted" | "qualified" | "proposal" | "won" | "lost";
  score?: number;
  notes?: string;
};

export type ProjectCreateArgs = {
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high" | "critical";
  status?: "planning" | "active" | "on_hold" | "completed" | "cancelled";
  startDate?: string;
  dueDate?: string;
};

export type NoteCreateArgs = {
  content: string;
  title?: string;
  entityType?: string;
  entityId?: string;
};

export type ReminderCreateArgs = {
  title: string;
  note?: string;
  dueAt?: string;
};

export type MeetingCreateArgs = {
  title: string;
  attendee?: string;
  scheduledAt?: string;
  location?: string;
  notes?: string;
};

export type TeamMemberCreateArgs = {
  name: string;
  role?: string;
  email?: string;
  department?: string;
};

export type DepartmentCreateArgs = {
  name: string;
  description?: string;
};

export type DepartmentRenameArgs = {
  newName: string;
  id?: string;
  name?: string;
};
