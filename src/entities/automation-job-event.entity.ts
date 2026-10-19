import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AutomationJob } from './automation-job.entity';

@Entity('automation_job_events')
@Index(['jobId', 'createdAt'])
export class AutomationJobEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'job_id' })
  jobId: string;

  @Column({ type: 'text', name: 'from_state', nullable: true })
  fromState: string | null;

  @Column({ type: 'text', name: 'to_state', nullable: true })
  toState: string | null;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  meta: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => AutomationJob, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_id' })
  job: AutomationJob;
}
