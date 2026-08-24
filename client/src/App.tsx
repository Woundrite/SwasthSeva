import { FormEvent, useEffect, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, FileText, HeartPulse, LayoutDashboard, LogOut, Menu, Plus, Search, Settings, ShieldCheck, Stethoscope, UserRound, UsersRound, X } from 'lucide-react';
import { api, ApiError, Appointment, Doctor, Leave, Prescription, SymptomIntake, User, VisitNote, WorkingHour, setAuthFailureHandler } from '@/api';

type Screen = 'overview' | 'appointments' | 'doctors' | 'schedule' | 'settings';
const today = new Date().toISOString().slice(0, 10);
const formatDate = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const formatTime = (value: string) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
const statusLabel = (status: Appointment['status']) => status.replace('_', ' ');

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [screen, setScreen] = useState<Screen>('overview');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [authError, setAuthError] = useState('');

  useEffect(() => { api.bootstrap().then((data) => setUser(data?.user || null)).finally(() => setBooting(false)); }, []);
  useEffect(() => { const path = new URLSearchParams(window.location.search); if (path.get('google')) setScreen('settings'); }, []);
  // A mid-session refresh failure (expired/reused refresh cookie) clears the
  // user so the app falls back to the login screen instead of leaving every
  // subsequent request silently failing.
  useEffect(() => { setAuthFailureHandler(() => setUser(null)); return () => setAuthFailureHandler(null); }, []);

  if (booting) return <div className="center-state"><div className="brand-mark"><HeartPulse size={20} /></div><span>Opening your care workspace</span></div>;
  if (!user) return <AuthScreen mode={authMode} setMode={setAuthMode} error={authError} onSuccess={setUser} onError={setAuthError} />;

  const navigate = (next: Screen, id?: string) => { setScreen(next); setSelectedId(id || null); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  return <Shell user={user} screen={screen} navigate={navigate} onLogout={() => { api.logout().catch(() => undefined); setUser(null); }}>
    {screen === 'overview' && <Overview user={user} navigate={navigate} />}
    {screen === 'appointments' && <Appointments user={user} selectedId={selectedId} navigate={navigate} />}
    {screen === 'doctors' && <Doctors user={user} selectedId={selectedId} navigate={navigate} />}
    {screen === 'schedule' && <Schedule />}
    {screen === 'settings' && <SettingsPage user={user} />}
  </Shell>;
}

function AuthScreen({ mode, setMode, error, onSuccess, onError }: { mode: 'login' | 'register'; setMode: (mode: 'login' | 'register') => void; error: string; onSuccess: (user: User) => void; onError: (message: string) => void }) {
  const [form, setForm] = useState({ email: '', password: '', fullName: '', phone: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); onError(''); try { const next = mode === 'login' ? await api.login({ email: form.email, password: form.password }) : await api.register(form); onSuccess(next); } catch (e) { onError(e instanceof ApiError ? e.message : 'We could not complete that request.'); } finally { setBusy(false); } };
  return <main className="auth-page"><div className="auth-visual"><div className="brand"><div className="brand-mark"><HeartPulse size={20} /></div><span>MediFlow</span></div><div className="auth-message"><p className="eyebrow">Care, in rhythm</p><h1>Appointments that feel more human.</h1><p>One calm place for patients, clinicians, and the care teams behind them.</p></div><div className="trust-note"><ShieldCheck size={18} /><span>Your care workspace is private and secure.</span></div></div><div className="auth-panel"><div className="auth-form"><div className="mobile-brand brand"><div className="brand-mark"><HeartPulse size={20} /></div><span>MediFlow</span></div><p className="eyebrow">{mode === 'login' ? 'Welcome back' : 'Start your care journey'}</p><h2>{mode === 'login' ? 'Sign in to MediFlow' : 'Create your patient account'}</h2><p className="muted">{mode === 'login' ? 'Enter your details to continue.' : 'Your account gives you one simple view of every appointment.'}</p>{error && <div className="alert error">{error}</div>}<form onSubmit={submit}>{mode === 'register' && <><Field label="Full name" value={form.fullName} onChange={(v) => setForm({ ...form, fullName: v })} required /><Field label="Phone (optional)" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} /></>}<Field label="Email address" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} required /><Field label="Password" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} required /><button className="primary-btn wide" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}<ArrowRight size={17} /></button></form><p className="switch-auth">{mode === 'login' ? 'New to MediFlow?' : 'Already have an account?'} <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); onError(''); }}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button></p></div></div></main>;
}

function Shell({ user, screen, navigate, onLogout, children }: { user: User; screen: Screen; navigate: (screen: Screen, id?: string) => void; onLogout: () => void; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const items: { id: Screen; label: string; icon: typeof LayoutDashboard }[] = user.role === 'PATIENT' ? [{ id: 'overview', label: 'Overview', icon: LayoutDashboard }, { id: 'appointments', label: 'My appointments', icon: CalendarDays }, { id: 'doctors', label: 'Find a doctor', icon: Stethoscope }, { id: 'settings', label: 'Settings', icon: Settings }] : user.role === 'DOCTOR' ? [{ id: 'overview', label: 'Today', icon: LayoutDashboard }, { id: 'appointments', label: 'Appointments', icon: CalendarDays }, { id: 'schedule', label: 'My schedule', icon: Clock3 }, { id: 'settings', label: 'Settings', icon: Settings }] : [{ id: 'overview', label: 'Overview', icon: LayoutDashboard }, { id: 'doctors', label: 'Doctors', icon: UsersRound }, { id: 'settings', label: 'Settings', icon: Settings }];
  return <div className="app-shell"><aside className={mobileOpen ? 'sidebar open' : 'sidebar'}><div className="brand"><div className="brand-mark"><HeartPulse size={20} /></div><span>MediFlow</span></div><div className="workspace-label">Workspace</div><nav>{items.map(({ id, label, icon: Icon }) => <button key={id} className={screen === id ? 'nav-item active' : 'nav-item'} onClick={() => { navigate(id); setMobileOpen(false); }}><Icon size={18} />{label}</button>)}</nav><div className="sidebar-bottom"><button className="nav-item" onClick={() => navigate('settings')}><UserRound size={18} />{user.fullName.split(' ')[0]}</button><button className="nav-item muted-nav" onClick={onLogout}><LogOut size={17} />Sign out</button></div></aside><div className="main-area"><header className="topbar"><button className="menu-btn" onClick={() => setMobileOpen(!mobileOpen)}><Menu size={20} /></button><div className="topbar-context"><span className="context-dot" />{user.role === 'PATIENT' ? 'Patient workspace' : user.role === 'DOCTOR' ? 'Clinical workspace' : 'Admin workspace'}</div><div className="topbar-actions"><button className="icon-btn" onClick={() => navigate('settings')}><Settings size={18} /></button><div className="avatar">{user.fullName.split(' ').map((n) => n[0]).join('').slice(0, 2)}</div></div></header><main className="content">{children}</main></div></div>;
}

function Overview({ user, navigate }: { user: User; navigate: (screen: Screen, id?: string) => void }) {
  return user.role === 'PATIENT' ? <PatientOverview user={user} navigate={navigate} /> : user.role === 'DOCTOR' ? <DoctorOverview navigate={navigate} /> : <AdminOverview navigate={navigate} />;
}

function PatientOverview({ user, navigate }: { user: User; navigate: (screen: Screen, id?: string) => void }) {
  const [appointments, setAppointments] = useState<Appointment[]>([]); const [loading, setLoading] = useState(true);
  useEffect(() => { api.appointments().then((d) => setAppointments(d.appointments)).catch(() => undefined).finally(() => setLoading(false)); }, []);
  const upcoming = appointments.filter((a) => a.status === 'SCHEDULED' && new Date(a.startsAt) > new Date()).sort((a, b) => a.startsAt.localeCompare(b.startsAt)); const next = upcoming[0];
  return <><PageHeading eyebrow="Good morning" title={user.fullName.split(' ')[0]} description="Stay close to the care that keeps you well." action={<button className="primary-btn" onClick={() => navigate('doctors')}><Plus size={17} />Book an appointment</button>} /><div className="stats-grid"><Stat label="Upcoming" value={String(upcoming.length)} icon={<CalendarDays size={19} />} tone="teal" /><Stat label="Completed visits" value={String(appointments.filter((a) => a.status === 'COMPLETED').length)} icon={<Check size={19} />} tone="blue" /><Stat label="Care timezone" value={user.timezone || 'Local'} icon={<Clock3 size={19} />} tone="sand" /></div><section className="section-block"><div className="section-title"><div><p className="eyebrow">Next up</p><h3>Your care calendar</h3></div><button className="text-btn" onClick={() => navigate('appointments')}>View all <ArrowRight size={15} /></button></div>{loading ? <Loading /> : next ? <AppointmentCard appointment={next} onClick={() => navigate('appointments', next.id)} /> : <Empty title="No upcoming appointments" body="When you book a visit, it will appear here." action={<button className="secondary-btn" onClick={() => navigate('doctors')}>Find a doctor</button>} />}</section><section className="split-section"><div className="quiet-card"><div className="quiet-icon"><HeartPulse size={20} /></div><div><h3>Prepare for your visit</h3><p>Share your symptoms before your appointment so your care team can make the most of your time together.</p><button className="text-btn" onClick={() => navigate('appointments')}>View appointments <ArrowRight size={15} /></button></div></div><div className="info-card"><p className="eyebrow">Your details</p><h3>{user.fullName}</h3><p>{user.email}</p><p>{user.phone || 'No phone added'}</p><button className="text-btn" onClick={() => navigate('settings')}>Manage details <ArrowRight size={15} /></button></div></section></>;
}

function DoctorOverview({ navigate }: { navigate: (screen: Screen, id?: string) => void }) { const [appointments, setAppointments] = useState<Appointment[]>([]); useEffect(() => { api.appointments().then((d) => setAppointments(d.appointments)).catch(() => undefined); }, []); const todayVisits = appointments.filter((a) => a.startsAt.slice(0, 10) === today && a.status !== 'CANCELLED'); return <><PageHeading eyebrow={new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())} title="Your clinical day" description="A focused view of the care on your calendar." action={<button className="secondary-btn" onClick={() => navigate('schedule')}><Clock3 size={17} />Manage schedule</button>} /><div className="stats-grid"><Stat label="Today's visits" value={String(todayVisits.length)} icon={<CalendarDays size={19} />} tone="teal" /><Stat label="Scheduled total" value={String(appointments.filter((a) => a.status === 'SCHEDULED').length)} icon={<Activity size={19} />} tone="blue" /><Stat label="Completed" value={String(appointments.filter((a) => a.status === 'COMPLETED').length)} icon={<Check size={19} />} tone="sand" /></div><section className="section-block"><div className="section-title"><div><p className="eyebrow">Today</p><h3>Appointments</h3></div><button className="text-btn" onClick={() => navigate('appointments')}>Full calendar <ArrowRight size={15} /></button></div>{todayVisits.length ? <div className="appointment-list">{todayVisits.map((a) => <AppointmentCard key={a.id} appointment={a} onClick={() => navigate('appointments', a.id)} />)}</div> : <Empty title="Your schedule is clear" body="There are no appointments scheduled for today." />}</section></>; }

function AdminOverview({ navigate }: { navigate: (screen: Screen, id?: string) => void }) { const [doctors, setDoctors] = useState<Doctor[]>([]); useEffect(() => { api.adminDoctors().then((d) => setDoctors(d.doctors)).catch(() => undefined); }, []); return <><PageHeading eyebrow="Operations" title="Care team overview" description="Keep your clinical team ready to deliver great care." action={<button className="primary-btn" onClick={() => navigate('doctors')}><Plus size={17} />Add a doctor</button>} /><div className="stats-grid"><Stat label="Care team" value={String(doctors.length)} icon={<UsersRound size={19} />} tone="teal" /><Stat label="Bookable now" value={String(doctors.filter((d) => d.isActive).length)} icon={<Check size={19} />} tone="blue" /><Stat label="Account access" value={String(doctors.filter((d) => d.accountEnabled).length)} icon={<ShieldCheck size={19} />} tone="sand" /></div><section className="section-block"><div className="section-title"><div><p className="eyebrow">Directory</p><h3>Doctors</h3></div><button className="text-btn" onClick={() => navigate('doctors')}>Manage team <ArrowRight size={15} /></button></div><div className="doctor-table">{doctors.slice(0, 5).map((d) => <DoctorRow key={d.id} doctor={d} onClick={() => navigate('doctors', d.id)} />)}</div></section></>; }

function Appointments({ user, selectedId, navigate }: { user: User; selectedId: string | null; navigate: (screen: Screen, id?: string) => void }) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  // Re-fetches every time we're back at the list (including right after
  // viewing a detail and cancelling/completing there) so a status change
  // made on the detail screen is reflected here without a manual refresh.
  // Deliberately doesn't flip `loading` back to true on that refetch, so the
  // already-visible list doesn't flash a spinner — it just swaps in fresh
  // data once the request resolves.
  useEffect(() => {
    if (selectedId) return;
    api.appointments().then((d) => setAppointments(d.appointments)).catch(() => undefined).finally(() => setLoading(false));
  }, [selectedId]);
  if (selectedId) return <AppointmentDetail id={selectedId} user={user} onBack={() => navigate('appointments')} />;
  const now = Date.now();
  const upcoming = appointments.filter((a) => a.status === 'SCHEDULED' && new Date(a.startsAt).getTime() >= now);
  const past = appointments.filter((a) => !(a.status === 'SCHEDULED' && new Date(a.startsAt).getTime() >= now));
  return (
    <>
      <PageHeading eyebrow={user.role === 'PATIENT' ? 'Your care' : 'Clinical workspace'} title="Appointments" description={user.role === 'PATIENT' ? 'Everything you have planned, in one place.' : 'Review visits and complete clinical documentation.'} action={user.role === 'PATIENT' ? <button className="primary-btn" onClick={() => navigate('doctors')}><Plus size={17} />Book an appointment</button> : undefined} />
      {loading ? <Loading /> : appointments.length ? (
        <div className="stack-form" style={{ gap: 28 }}>
          <section>
            <p className="eyebrow" style={{ marginBottom: 12 }}>Upcoming</p>
            {upcoming.length ? <div className="appointment-list">{upcoming.map((a) => <AppointmentCard key={a.id} appointment={a} onClick={() => navigate('appointments', a.id)} />)}</div> : <Empty title="Nothing upcoming" body="You have no scheduled appointments ahead." />}
          </section>
          {past.length > 0 && (
            <section>
              <p className="eyebrow" style={{ marginBottom: 12 }}>Past</p>
              <div className="appointment-list">{past.map((a) => <AppointmentCard key={a.id} appointment={a} onClick={() => navigate('appointments', a.id)} />)}</div>
            </section>
          )}
        </div>
      ) : <Empty title="No appointments yet" body={user.role === 'PATIENT' ? 'Book your first appointment to get started.' : 'Your appointments will appear here.'} />}
    </>
  );
}

function AppointmentCard({ appointment, onClick }: { appointment: Appointment; onClick: () => void }) { const person = appointment.doctor?.user.fullName || appointment.patient?.fullName || 'Care visit'; const detail = appointment.doctor?.specialisation || 'Patient appointment'; return <button className="appointment-card" onClick={onClick}><div className="date-tile"><strong>{new Date(appointment.startsAt).getDate()}</strong><span>{new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(appointment.startsAt))}</span></div><div className="appointment-main"><div className="appointment-top"><span className="eyebrow">{formatDate(appointment.startsAt)}</span><StatusBadge status={appointment.status} /></div><h3>{person}</h3><p>{detail} · {formatTime(appointment.startsAt)}</p>{appointment.reasonForVisit && <p className="reason">“{appointment.reasonForVisit}”</p>}</div><ArrowRight className="card-arrow" size={18} /></button>; }

function AppointmentDetail({ id, user, onBack }: { id: string; user: User; onBack: () => void }) {
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [completing, setCompleting] = useState(false);

  useEffect(() => { api.appointment(id).then((d) => setAppointment(d.appointment)).catch(() => undefined).finally(() => setLoading(false)); }, [id]);

  // The AI pre-visit briefing generates asynchronously; poll while it's
  // still pending so it appears without the doctor needing to refresh.
  useEffect(() => {
    if (appointment?.preVisitSummary?.status !== 'PENDING') return;
    const interval = setInterval(() => {
      api.appointment(id).then((d) => setAppointment(d.appointment)).catch(() => undefined);
    }, 3000);
    return () => clearInterval(interval);
  }, [id, appointment?.preVisitSummary?.status]);

  if (loading) return <Loading />;
  if (!appointment) return <Empty title="Appointment unavailable" body="This appointment could not be loaded." />;

  const isPatient = user.role === 'PATIENT';
  const canIntake = isPatient && appointment.status === 'SCHEDULED' && new Date(appointment.startsAt) > new Date();
  const canClinical = !isPatient && (appointment.status === 'SCHEDULED' || appointment.status === 'COMPLETED') && new Date(appointment.startsAt) <= new Date();
  const update = (next: Appointment) => setAppointment(next);

  const cancel = async () => {
    setCancelling(true);
    setError('');
    try {
      const d = await api.cancel(id);
      update(d.appointment);
      setMessage('Appointment cancelled.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel this appointment.');
    } finally {
      setCancelling(false);
    }
  };
  const complete = async () => {
    setCompleting(true);
    setError('');
    try {
      const d = await api.complete(id);
      update(d.appointment);
      setMessage('Appointment marked complete.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not complete this appointment.');
    } finally {
      setCompleting(false);
    }
  };

  return (
    <>
      <button className="back-btn" onClick={onBack}><ArrowLeft size={16} />Back to appointments</button>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">{isPatient ? 'Appointment details' : 'Clinical visit'}</p>
          <h1>{isPatient ? appointment.doctor?.user.fullName : appointment.patient?.fullName}</h1>
          <p className="muted">{appointment.doctor?.specialisation || 'Scheduled visit'} · {formatDate(appointment.startsAt)} at {formatTime(appointment.startsAt)}</p>
        </div>
        <StatusBadge status={appointment.status} />
      </div>
      {message && <div className="alert success"><Check size={17} />{message}</div>}
      {error && <div className="alert error">{error}</div>}
      <div className="detail-grid">
        <div className="detail-column">
          <section className="panel">
            <PanelHeading icon={<CalendarDays size={18} />} title="Appointment information" />
            <DetailRow label="Date" value={formatDate(appointment.startsAt)} />
            <DetailRow label="Time" value={formatTime(appointment.startsAt)} />
            <DetailRow label="Reason for visit" value={appointment.reasonForVisit || 'Not provided'} />
            {appointment.status === 'CANCELLED' && appointment.cancelledAt && <DetailRow label="Cancelled on" value={formatDate(appointment.cancelledAt)} />}
          </section>
          {isPatient ? (
            <>
              <SymptomSection appointment={appointment} canEdit={canIntake} onSaved={(next) => { update({ ...appointment, symptomIntake: next }); setMessage('Your symptom intake has been saved.'); }} />
              <PrescriptionSection appointment={appointment} canEdit={false} onSaved={() => {}} />
            </>
          ) : (
            <>
              <ClinicalSummary summary={appointment.preVisitSummary} />
              <ClinicalDocumentation
                appointment={appointment}
                canEdit={canClinical}
                onVisitNoteSaved={(next) => { update({ ...appointment, visitNote: next }); setMessage('Visit note saved.'); }}
                onPrescriptionSaved={(next) => { update({ ...appointment, prescription: next }); setMessage('Prescription saved.'); }}
              />
            </>
          )}
        </div>
        <aside className="detail-aside">
          {isPatient && appointment.status === 'SCHEDULED' && (
            <div className="action-card">
              <p className="eyebrow">Need to make a change?</p>
              <h3>Cancel appointment</h3>
              <p className="muted">This action cannot be undone.</p>
              <button className="danger-btn" disabled={cancelling} onClick={cancel}>{cancelling ? 'Cancelling…' : 'Cancel appointment'}</button>
            </div>
          )}
          {!isPatient && canClinical && (
            <div className="action-card accent-card">
              <p className="eyebrow">Close the loop</p>
              <h3>Mark this visit complete</h3>
              <p className="muted">Complete after your clinical documentation is ready.</p>
              <button className="primary-btn" disabled={completing} onClick={complete}>{completing ? 'Completing…' : 'Complete visit'} <Check size={16} /></button>
            </div>
          )}
          <div className="side-note"><ShieldCheck size={18} /><p>Clinical information is only visible to the people involved in this appointment.</p></div>
        </aside>
      </div>
    </>
  );
}

function SymptomSection({ appointment, canEdit, onSaved }: { appointment: Appointment; canEdit: boolean; onSaved: (data: SymptomIntake) => void }) {
  const [form, setForm] = useState({ symptoms: appointment.symptomIntake?.symptoms || '', durationText: appointment.symptomIntake?.durationText || '', severity: appointment.symptomIntake?.severity || 5, existingConditions: appointment.symptomIntake?.existingConditions || '', currentMedications: appointment.symptomIntake?.currentMedications || '', additionalNotes: appointment.symptomIntake?.additionalNotes || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api.symptomIntake(appointment.id, form);
      onSaved(d.symptomIntake);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your symptom intake.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <PanelHeading icon={<Activity size={18} />} title="Symptom intake" action={!canEdit && appointment.symptomIntake ? <span className="saved-label"><Check size={14} />Submitted</span> : undefined} />
      {canEdit ? (
        <form className="stack-form" onSubmit={submit}>
          {error && <div className="alert error">{error}</div>}
          <Field label="What brings you in today?" value={form.symptoms} onChange={(v) => setForm({ ...form, symptoms: v })} textarea required />
          <div className="form-row">
            <Field label="How long has this been happening?" value={form.durationText} onChange={(v) => setForm({ ...form, durationText: v })} />
            <label className="field"><span>Severity <strong>{form.severity}/10</strong></span><input type="range" min="1" max="10" value={form.severity} onChange={(e) => setForm({ ...form, severity: Number(e.target.value) })} /></label>
          </div>
          <Field label="Existing conditions" value={form.existingConditions} onChange={(v) => setForm({ ...form, existingConditions: v })} textarea />
          <Field label="Current medications" value={form.currentMedications} onChange={(v) => setForm({ ...form, currentMedications: v })} textarea />
          <Field label="Anything else your doctor should know?" value={form.additionalNotes} onChange={(v) => setForm({ ...form, additionalNotes: v })} textarea />
          <button className="primary-btn" disabled={busy}>{busy ? 'Saving…' : 'Save symptom intake'} <ArrowRight size={16} /></button>
        </form>
      ) : appointment.symptomIntake ? (
        <ReadOnlyIntake data={appointment.symptomIntake} />
      ) : (
        <Empty title="No symptom intake yet" body="The patient has not submitted pre-visit details." />
      )}
    </section>
  );
}

function ReadOnlyIntake({ data }: { data: NonNullable<Appointment['symptomIntake']> }) { return <div className="read-grid"><DetailRow label="Symptoms" value={data.symptoms} /><DetailRow label="Duration" value={data.durationText || 'Not provided'} /><DetailRow label="Severity" value={data.severity ? `${data.severity}/10` : 'Not provided'} /><DetailRow label="Existing conditions" value={data.existingConditions || 'None provided'} /><DetailRow label="Current medications" value={data.currentMedications || 'None provided'} /><DetailRow label="Additional notes" value={data.additionalNotes || 'None provided'} /></div>; }

function ClinicalSummary({ summary }: { summary?: Appointment['preVisitSummary'] }) { return <section className="panel clinical-panel"><PanelHeading icon={<Activity size={18} />} title="Pre-visit briefing" action={summary?.source === 'FALLBACK' ? <span className="source-label">Care summary</span> : undefined} />{!summary || summary.status === 'PENDING' ? <div className="generating"><div className="pulse-dot" /><div><strong>Preparing the briefing</strong><p className="muted">The care summary is being generated from the patient intake.</p></div></div> : summary.status === 'FAILED' ? <div className="empty-inline"><FileText size={18} /><span>The briefing is unavailable. Review the symptom intake below.</span></div> : summary.payload ? <div className="briefing"><div className={`urgency ${summary.urgency?.toLowerCase()}`}>Urgency: {summary.urgency?.toLowerCase()}</div><p className="summary-text">{summary.payload.summary}</p><div className="briefing-columns"><BriefList title="Key points" items={summary.payload.keyPoints} /><BriefList title="Suggested questions" items={summary.payload.suggestedQuestions} /></div></div> : null}</section>; }
function BriefList({ title, items }: { title: string; items: string[] }) { return <div><p className="eyebrow">{title}</p><ul className="brief-list">{items.map((item) => <li key={item}>{item}</li>)}</ul></div>; }

function VisitNoteContent({ appointment, canEdit, onSaved }: { appointment: Appointment; canEdit: boolean; onSaved: (data: VisitNote) => void }) {
  const [form, setForm] = useState(appointment.visitNote || { diagnosis: '', clinicalNotes: '', followUpDate: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api.visitNote(appointment.id, form);
      onSaved(d.visitNote);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the visit note.');
    } finally {
      setBusy(false);
    }
  };
  return canEdit ? (
    <form className="stack-form" onSubmit={submit}>
      {error && <div className="alert error">{error}</div>}
      <Field label="Diagnosis" value={form.diagnosis} onChange={(v) => setForm({ ...form, diagnosis: v })} required />
      <Field label="Clinical notes" value={form.clinicalNotes} onChange={(v) => setForm({ ...form, clinicalNotes: v })} textarea required />
      <Field label="Follow-up date (optional)" type="date" value={form.followUpDate || ''} onChange={(v) => setForm({ ...form, followUpDate: v })} />
      <button className="secondary-btn" disabled={busy}>{busy ? 'Saving…' : 'Save visit note'}</button>
    </form>
  ) : appointment.visitNote ? (
    <div className="read-grid">
      <DetailRow label="Diagnosis" value={appointment.visitNote.diagnosis} />
      <DetailRow label="Clinical notes" value={appointment.visitNote.clinicalNotes} />
      <DetailRow label="Follow-up date" value={appointment.visitNote.followUpDate || 'Not scheduled'} />
    </div>
  ) : (
    <Empty title="No visit note yet" body="Add clinical notes after the visit." />
  );
}
type PrescriptionItemForm = { medicationName: string; dosage: string; frequencyPerDay: number; timesOfDay: string[]; durationDays: number; startDate: string; instructions: string };
function emptyPrescriptionItem(): PrescriptionItemForm { return { medicationName: '', dosage: '', frequencyPerDay: 1, timesOfDay: ['08:00'], durationDays: 5, startDate: today, instructions: '' }; }

// Doctor's editable/read view is embedded (no outer panel) inside
// ClinicalDocumentation, alongside visit notes, in one combined panel. The
// patient's read-only view has no visit notes to sit next to, so it keeps
// its own standalone panel via the PrescriptionSection wrapper below.
function PrescriptionContent({ appointment, canEdit, onSaved }: { appointment: Appointment; canEdit: boolean; onSaved: (data: Prescription) => void }) {
  const [generalInstructions, setGeneralInstructions] = useState(appointment.prescription?.generalInstructions || '');
  const [items, setItems] = useState<PrescriptionItemForm[]>(
    appointment.prescription?.items.length
      ? appointment.prescription.items.map((item) => ({ ...item, instructions: item.instructions || '' }))
      : [emptyPrescriptionItem()]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const updateItem = (index: number, patch: Partial<PrescriptionItemForm>) => {
    setItems(items.map((item, i) => {
      if (i !== index) return item;
      const next = { ...item, ...patch };
      if (patch.frequencyPerDay !== undefined) {
        const count = Math.max(1, patch.frequencyPerDay);
        next.timesOfDay = Array.from({ length: count }, (_, t) => item.timesOfDay[t] || '08:00');
      }
      return next;
    }));
  };
  const updateDoseTime = (itemIndex: number, doseIndex: number, value: string) => {
    setItems(items.map((item, i) => i !== itemIndex ? item : { ...item, timesOfDay: item.timesOfDay.map((t, d) => d === doseIndex ? value : t) }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api.prescription(appointment.id, { generalInstructions, items });
      onSaved(d.prescription);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the prescription.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {canEdit ? (
        <form className="stack-form" onSubmit={submit}>
          {error && <div className="alert error">{error}</div>}
          <Field label="General instructions" value={generalInstructions} onChange={setGeneralInstructions} textarea />
          {items.map((item, index) => (
            <div className="medication-row" key={index}>
              <div className="medication-row-heading">
                <strong>Medication {index + 1}</strong>
                {items.length > 1 && <button type="button" className="text-btn danger-text" onClick={() => setItems(items.filter((_, i) => i !== index))}>Remove</button>}
              </div>
              <div className="form-row">
                <Field label="Medication" value={item.medicationName} onChange={(v) => updateItem(index, { medicationName: v })} required />
                <Field label="Dosage" value={item.dosage} onChange={(v) => updateItem(index, { dosage: v })} required />
              </div>
              <div className="form-row">
                <Field label="Times per day" type="number" value={String(item.frequencyPerDay)} onChange={(v) => updateItem(index, { frequencyPerDay: Number(v) || 1 })} required />
                <Field label="Duration in days" type="number" value={String(item.durationDays)} onChange={(v) => updateItem(index, { durationDays: Number(v) || 1 })} required />
              </div>
              <Field label="Start date" type="date" value={item.startDate} onChange={(v) => updateItem(index, { startDate: v })} required />
              <label className="field">
                <span>Dose times</span>
                <div className="dose-time-grid">
                  {item.timesOfDay.map((time, doseIndex) => (
                    <input key={doseIndex} type="time" value={time} onChange={(e) => updateDoseTime(index, doseIndex, e.target.value)} />
                  ))}
                </div>
              </label>
              <Field label="Instructions (optional)" value={item.instructions} onChange={(v) => updateItem(index, { instructions: v })} textarea />
            </div>
          ))}
          <button type="button" className="secondary-btn compact-btn" onClick={() => setItems([...items, emptyPrescriptionItem()])}><Plus size={16} />Add medication</button>
          <button className="primary-btn" disabled={busy}>{busy ? 'Saving…' : 'Save prescription'}</button>
        </form>
      ) : appointment.prescription ? (
        <div className="prescription-read">
          <p>{appointment.prescription.generalInstructions || 'Follow the medication instructions provided by your care team.'}</p>
          {appointment.prescription.items.map((item, i) => (
            <div className="medication" key={i}>
              <strong>{item.medicationName}</strong>
              <span>{item.dosage} · {item.frequencyPerDay}× daily ({item.timesOfDay.join(', ')}) · {item.durationDays} days</span>
              {item.instructions && <span>{item.instructions}</span>}
            </div>
          ))}
        </div>
      ) : (
        <Empty title="No prescription" body="A prescription will appear here when one is added." />
      )}
    </>
  );
}

// Standalone panel for the patient's read-only view (there's no visit note
// alongside it there, so it doesn't join the doctor's combined panel below).
function PrescriptionSection({ appointment, canEdit, onSaved }: { appointment: Appointment; canEdit: boolean; onSaved: (data: Prescription) => void }) {
  return (
    <section className="panel">
      <PanelHeading icon={<FileText size={18} />} title="Prescription" />
      <PrescriptionContent appointment={appointment} canEdit={canEdit} onSaved={onSaved} />
    </section>
  );
}

function ClinicalDocumentation({ appointment, canEdit, onVisitNoteSaved, onPrescriptionSaved }: { appointment: Appointment; canEdit: boolean; onVisitNoteSaved: (data: VisitNote) => void; onPrescriptionSaved: (data: Prescription) => void }) {
  return (
    <section className="panel">
      <PanelHeading icon={<FileText size={18} />} title="Clinical documentation" />
      <div className="doc-subsection">
        <p className="doc-subheading">Diagnosis &amp; notes</p>
        <VisitNoteContent appointment={appointment} canEdit={canEdit} onSaved={onVisitNoteSaved} />
      </div>
      <div className="doc-divider" />
      <div className="doc-subsection">
        <p className="doc-subheading">Prescription</p>
        <PrescriptionContent appointment={appointment} canEdit={canEdit} onSaved={onPrescriptionSaved} />
      </div>
    </section>
  );
}

function Doctors({ user, selectedId, navigate }: { user: User; selectedId: string | null; navigate: (screen: Screen, id?: string) => void }) { const [doctors, setDoctors] = useState<Doctor[]>([]); const [loading, setLoading] = useState(true); const [query, setQuery] = useState(''); const [showCreate, setShowCreate] = useState(false); useEffect(() => { if (selectedId) return; const load = user.role === 'ADMIN' ? api.adminDoctors() : api.doctors(); load.then((d) => setDoctors(d.doctors)).finally(() => setLoading(false)); }, [user.role, selectedId]); const filtered = doctors.filter((d) => `${d.fullName} ${d.specialisation}`.toLowerCase().includes(query.toLowerCase())); const isAdmin = user.role === 'ADMIN'; const backToList = () => navigate('doctors'); if (selectedId && user.role === 'PATIENT') return <DoctorDetail id={selectedId} onBack={backToList} />; if (selectedId && user.role === 'ADMIN') return <AdminDoctorDetail id={selectedId} onBack={backToList} />; return <><PageHeading eyebrow="Care team" title={isAdmin ? 'Manage doctors' : 'Find the right care'} description={isAdmin ? 'Keep your clinical team ready to deliver great care.' : 'Explore active specialists and choose the support that feels right.'} action={isAdmin ? <button className="primary-btn" onClick={() => setShowCreate(true)}><Plus size={17} />Add a doctor</button> : undefined} /><div className="search-wrap"><Search size={18} /><input placeholder="Search by name or speciality" value={query} onChange={(e) => setQuery(e.target.value)} /></div>{loading ? <Loading /> : filtered.length ? <div className="doctor-grid">{filtered.map((d) => <DoctorCard key={d.id} doctor={d} onClick={() => navigate('doctors', d.id)} />)}</div> : <Empty title="No doctors found" body="Try a different search." />}{showCreate && <CreateDoctor onClose={() => setShowCreate(false)} onCreated={(d) => { setDoctors([...doctors, d]); setShowCreate(false); }} />}</>; }
function DoctorCard({ doctor, onClick }: { doctor: Doctor; onClick: () => void }) { return <button className="doctor-card" onClick={onClick}><div className="doctor-avatar">{doctor.fullName.split(' ').map((n) => n[0]).join('').slice(0, 2)}</div><div className="doctor-card-content"><span className="eyebrow">{doctor.specialisation}</span><h3>{doctor.fullName}</h3><p>{doctor.qualifications || 'Specialist care'}</p><div className="doctor-meta"><span><Clock3 size={14} />{doctor.slotDurationMinutes} min</span>{doctor.consultationFee && <span>₹{doctor.consultationFee}</span>}</div>{doctor.accountEnabled !== undefined && <div className="doctor-meta">{!doctor.isActive && <span className="pill inactive-pill">Not bookable</span>}{!doctor.accountEnabled && <span className="pill inactive-pill">Account disabled</span>}{doctor.isActive && doctor.accountEnabled && <span className="pill active-pill">Active</span>}</div>}</div><ArrowRight size={17} /></button>; }
function DoctorRow({ doctor, onClick }: { doctor: Doctor; onClick: () => void }) { return <button className="doctor-row" onClick={onClick}><div className="doctor-avatar small">{doctor.fullName.split(' ').map((n) => n[0]).join('').slice(0, 2)}</div><div><strong>{doctor.fullName}</strong><span>{doctor.specialisation}</span></div><span className={doctor.isActive ? 'pill active-pill' : 'pill inactive-pill'}>{doctor.isActive ? 'Bookable' : 'Paused'}</span><ArrowRight size={16} /></button>; }
function CreateDoctor({ onClose, onCreated }: { onClose: () => void; onCreated: (doctor: Doctor) => void }) {
  const [form, setForm] = useState<Record<string, string>>({ email: '', password: '', fullName: '', phone: '', timezone: 'Asia/Kolkata', specialisation: '', qualifications: '', bio: '', consultationFee: '', slotDurationMinutes: '30', bufferMinutes: '0', clinicTimezone: 'Asia/Kolkata' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api.createDoctor({ ...form, consultationFee: form.consultationFee ? Number(form.consultationFee) : undefined, slotDurationMinutes: Number(form.slotDurationMinutes), bufferMinutes: Number(form.bufferMinutes) });
      onCreated(d.doctor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create doctor.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Add a doctor" onClose={onClose}>
      <form className="stack-form" onSubmit={submit}>
        {error && <div className="alert error">{error}</div>}
        <div className="form-row">
          <Field label="Full name" value={form.fullName} onChange={(v) => setForm({ ...form, fullName: v })} required />
          <Field label="Specialisation" value={form.specialisation} onChange={(v) => setForm({ ...form, specialisation: v })} required />
        </div>
        <div className="form-row">
          <Field label="Email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} required />
          <Field label="Temporary password" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} required />
        </div>
        <div className="form-row">
          <Field label="Phone (optional)" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <Field label="Personal timezone" value={form.timezone} onChange={(v) => setForm({ ...form, timezone: v })} />
        </div>
        <Field label="Qualifications" value={form.qualifications} onChange={(v) => setForm({ ...form, qualifications: v })} />
        <Field label="Bio" value={form.bio} onChange={(v) => setForm({ ...form, bio: v })} textarea />
        <div className="form-row">
          <Field label="Consultation fee" type="number" value={form.consultationFee} onChange={(v) => setForm({ ...form, consultationFee: v })} />
          <Field label="Slot duration (minutes)" type="number" value={form.slotDurationMinutes} onChange={(v) => setForm({ ...form, slotDurationMinutes: v })} />
        </div>
        <div className="form-row">
          <Field label="Buffer between slots (minutes)" type="number" value={form.bufferMinutes} onChange={(v) => setForm({ ...form, bufferMinutes: v })} />
          <Field label="Clinic timezone" value={form.clinicTimezone} onChange={(v) => setForm({ ...form, clinicTimezone: v })} required />
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onClose}>Cancel</button>
          <button className="primary-btn" disabled={busy}>{busy ? 'Creating…' : 'Create doctor'}</button>
        </div>
      </form>
    </Modal>
  );
}

// Shared by the doctor's own schedule page and admin's per-doctor schedule
// management. Supports any number of blocks per weekday (e.g. a split shift
// of 9am-1pm and 5pm-8pm on the same day) — the backend's working-hours
// model always supported this; only the original single-row-per-day UI
// didn't expose it. Submits the exact { dayOfWeek, startMinute, endMinute }[]
// shape PUT /doctors/:doctorId/working-hours expects (client-side ids are
// stripped by the caller before sending, same as before).
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function WorkingHoursEditor({ hours, setHours }: { hours: WorkingHour[]; setHours: (h: WorkingHour[]) => void }) {
  const addBlock = (dayOfWeek: number) => {
    setHours([...hours, { id: `new-${Date.now()}-${dayOfWeek}-${Math.random().toString(36).slice(2, 7)}`, dayOfWeek, startMinute: 9 * 60, endMinute: 17 * 60 }]);
  };
  const updateBlock = (blockId: string, patch: Partial<WorkingHour>) => {
    setHours(hours.map((h) => (h.id === blockId ? { ...h, ...patch } : h)));
  };
  const removeBlock = (blockId: string) => {
    setHours(hours.filter((h) => h.id !== blockId));
  };

  return (
    <div className="hours-list">
      {DAY_NAMES.map((day, dayIndex) => {
        const blocks = hours.filter((h) => h.dayOfWeek === dayIndex).sort((a, b) => a.startMinute - b.startMinute);
        return (
          <div className="hours-day" key={day}>
            <div className="hours-day-heading">
              <strong>{day}</strong>
              <button type="button" className="text-btn" onClick={() => addBlock(dayIndex)}><Plus size={14} />Add block</button>
            </div>
            {blocks.length === 0 && <p className="hours-empty">Not working</p>}
            {blocks.map((block) => (
              <div className="hours-block-row" key={block.id}>
                <input type="time" value={minutesToTime(block.startMinute)} onChange={(e) => updateBlock(block.id, { startMinute: timeToMinutes(e.target.value) })} />
                <span>to</span>
                <input type="time" value={minutesToTime(block.endMinute)} onChange={(e) => updateBlock(block.id, { endMinute: timeToMinutes(e.target.value) })} />
                <button type="button" className="icon-btn" onClick={() => removeBlock(block.id)} aria-label={`Remove ${day} block`}><X size={15} /></button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function AdminDoctorDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [hours, setHours] = useState<WorkingHour[]>([]);
  const [leave, setLeave] = useState<Leave[]>([]);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hoursError, setHoursError] = useState('');
  const [savingHours, setSavingHours] = useState(false);
  const [form, setForm] = useState({ specialisation: '', qualifications: '', bio: '', consultationFee: '', slotDurationMinutes: '30', bufferMinutes: '0', clinicTimezone: '', isActive: true, accountEnabled: true });

  useEffect(() => {
    api.adminDoctor(id).then((d) => {
      setDoctor(d.doctor);
      setForm({
        specialisation: d.doctor.specialisation,
        qualifications: d.doctor.qualifications || '',
        bio: d.doctor.bio || '',
        consultationFee: d.doctor.consultationFee ? String(d.doctor.consultationFee) : '',
        slotDurationMinutes: String(d.doctor.slotDurationMinutes),
        bufferMinutes: String(d.doctor.bufferMinutes || 0),
        clinicTimezone: d.doctor.clinicTimezone,
        isActive: Boolean(d.doctor.isActive),
        accountEnabled: Boolean(d.doctor.accountEnabled),
      });
      return Promise.all([api.workingHours(id), api.leave(id)]);
    }).then((result) => {
      if (!result) return;
      setHours(result[0].workingHours);
      setLeave(result[1].leave);
    }).catch(() => undefined);
  }, [id]);

  if (!doctor) return <Loading />;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api.updateDoctor(id, { ...form, consultationFee: form.consultationFee ? Number(form.consultationFee) : undefined, slotDurationMinutes: Number(form.slotDurationMinutes), bufferMinutes: Number(form.bufferMinutes) });
      setDoctor(d.doctor);
      setSaved('Doctor details saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save doctor details.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="back-btn" onClick={onBack}><ArrowLeft size={16} />Back to doctors</button>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Doctor profile</p>
          <h1>{doctor.fullName}</h1>
          <p className="muted">{doctor.email}</p>
        </div>
        <span className={doctor.isActive ? 'pill active-pill' : 'pill inactive-pill'}>{doctor.isActive ? 'Bookable' : 'Paused'}</span>
      </div>
      {saved && <div className="alert success"><Check size={17} />{saved}</div>}
      <div className="settings-layout">
        <section className="panel">
          <PanelHeading icon={<Stethoscope size={18} />} title="Profile and access" />
          <form className="stack-form" onSubmit={save}>
            {error && <div className="alert error">{error}</div>}
            <div className="form-row">
              <Field label="Specialisation" value={form.specialisation} onChange={(v) => setForm({ ...form, specialisation: v })} required />
              <Field label="Qualifications" value={form.qualifications} onChange={(v) => setForm({ ...form, qualifications: v })} />
            </div>
            <Field label="Bio" value={form.bio} onChange={(v) => setForm({ ...form, bio: v })} textarea />
            <div className="form-row">
              <Field label="Consultation fee" type="number" value={form.consultationFee} onChange={(v) => setForm({ ...form, consultationFee: v })} />
              <Field label="Slot duration" type="number" value={form.slotDurationMinutes} onChange={(v) => setForm({ ...form, slotDurationMinutes: v })} />
            </div>
            <div className="form-row">
              <Field label="Buffer between slots (minutes)" type="number" value={form.bufferMinutes} onChange={(v) => setForm({ ...form, bufferMinutes: v })} />
              <Field label="Clinic timezone" value={form.clinicTimezone} onChange={(v) => setForm({ ...form, clinicTimezone: v })} required />
            </div>
            <div className="form-row">
              <label className="check-field"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /><span>Bookable by patients</span></label>
              <label className="check-field"><input type="checkbox" checked={form.accountEnabled} onChange={(e) => setForm({ ...form, accountEnabled: e.target.checked })} /><span>Account can sign in</span></label>
            </div>
            <button className="primary-btn" disabled={busy}>{busy ? 'Saving…' : 'Save doctor'}</button>
          </form>
        </section>
        <section className="panel">
          <PanelHeading icon={<Clock3 size={18} />} title="Working hours" />
          {hoursError && <div className="alert error">{hoursError}</div>}
          <WorkingHoursEditor hours={hours} setHours={setHours} />
          <button
            className="secondary-btn"
            style={{ marginTop: 18 }}
            disabled={savingHours}
            onClick={async () => {
              setSavingHours(true);
              setHoursError('');
              try {
                const d = await api.saveWorkingHours(id, hours.map((h) => ({ dayOfWeek: h.dayOfWeek, startMinute: h.startMinute, endMinute: h.endMinute })));
                setHours(d.workingHours);
                setSaved('Working hours saved.');
              } catch (err) {
                setHoursError(err instanceof ApiError ? err.message : 'Could not save working hours.');
              } finally {
                setSavingHours(false);
              }
            }}
          >
            {savingHours ? 'Saving…' : 'Save hours'}
          </button>
        </section>
        <div style={{ gridColumn: '1 / -1' }}>
          <LeavePanel doctorId={id} leave={leave} setLeave={setLeave} />
        </div>
      </div>
    </>
  );
}

const emptyIntakeForm = () => ({ symptoms: '', durationText: '', severity: 5, existingConditions: '', currentMedications: '', additionalNotes: '' });

function DoctorDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<{ startsAt: string; endsAt: string }[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<{ startsAt: string; endsAt: string } | null>(null);
  const [reason, setReason] = useState('');
  const [intake, setIntake] = useState(emptyIntakeForm());
  const [booked, setBooked] = useState('');
  const [warning, setWarning] = useState('');
  const [error, setError] = useState('');
  const [booking, setBooking] = useState(false);

  useEffect(() => { api.doctors().then((d) => setDoctor(d.doctors.find((item) => item.id === id) || null)); }, [id]);
  useEffect(() => {
    if (doctor) api.availability(doctor.id, date).then((d) => setSlots(d.slots)).catch(() => setSlots([]));
    // A new date invalidates whatever was selected/shown for the previous one.
    setSelectedSlot(null);
    setBooked('');
    setError('');
  }, [doctor, date]);

  if (!doctor) return <Loading />;

  // Selecting a slot only stages it — booking only happens once the patient
  // reviews the details and explicitly confirms, matching how appointment
  // booking has always worked here (this used to fire immediately on slot
  // click, which skipped that confirmation step entirely). The backend has
  // no combined "book + intake" endpoint — booking and symptom intake are
  // two separate resources (intake is keyed off the appointment's id, which
  // doesn't exist until booking succeeds) — so this chains the same two
  // existing calls the old post-booking flow used, just back-to-back from
  // one form instead of asking the patient to come back for the second step.
  const confirmBooking = async () => {
    if (!selectedSlot) return;
    setBooking(true);
    setError('');
    setWarning('');
    try {
      const result = await api.book({ doctorId: doctor.id, startsAt: selectedSlot.startsAt, reasonForVisit: reason });
      setBooked(`Booked for ${formatDate(selectedSlot.startsAt)} at ${formatTime(selectedSlot.startsAt)}.`);
      setSlots(slots.filter((s) => s.startsAt !== selectedSlot.startsAt));
      setSelectedSlot(null);
      setReason('');
      if (intake.symptoms.trim()) {
        try {
          await api.symptomIntake(result.appointment.id, intake);
        } catch (err) {
          setWarning(err instanceof ApiError ? `Appointment booked, but your symptom details could not be saved: ${err.message} You can add them from the appointment.` : 'Appointment booked, but your symptom details could not be saved. You can add them from the appointment.');
        }
      }
      setIntake(emptyIntakeForm());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not book this slot. It may no longer be available.');
    } finally {
      setBooking(false);
    }
  };

  return (
    <>
      <button className="back-btn" onClick={onBack}><ArrowLeft size={16} />Back to doctors</button>
      <div className="doctor-profile">
        <div className="doctor-avatar large">{doctor.fullName.split(' ').map((n) => n[0]).join('').slice(0, 2)}</div>
        <div>
          <p className="eyebrow">{doctor.specialisation}</p>
          <h1>{doctor.fullName}</h1>
          <p className="muted">{doctor.qualifications || 'Specialist care'} · {doctor.clinicTimezone}</p>
          <p className="bio">{doctor.bio || 'Focused, thoughtful care tailored to your needs.'}</p>
        </div>
      </div>
      <div className="booking-layout">
        <section className="panel">
          <PanelHeading icon={<CalendarDays size={18} />} title="Choose a time" />
          <label className="field"><span>Date</span><input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <div className="slot-grid">
            {slots.length ? slots.map((slot) => (
              <button
                key={slot.startsAt}
                className={`slot-btn${selectedSlot?.startsAt === slot.startsAt ? ' selected' : ''}`}
                disabled={booking}
                onClick={() => { setSelectedSlot(slot); setError(''); setBooked(''); }}
              >
                {formatTime(slot.startsAt)}
              </button>
            )) : <p className="muted">No available times for this date.</p>}
          </div>
          {booked && <div className="alert success"><Check size={17} />{booked}</div>}
          {warning && <div className="alert error">{warning}</div>}
        </section>
        <aside className="panel booking-note">
          {selectedSlot ? (
            <>
              <p className="eyebrow">Confirm your booking</p>
              <h3>{formatDate(selectedSlot.startsAt)} at {formatTime(selectedSlot.startsAt)}</h3>
              <p>With {doctor.fullName} · {doctor.specialisation}</p>
              {error && <div className="alert error">{error}</div>}
              <Field label="Reason for visit (optional)" value={reason} onChange={setReason} textarea rows={2} />
              <div className="intake-block">
                <div className="intake-block-heading">
                  <div className="panel-icon small"><Activity size={15} /></div>
                  <div>
                    <h4>Help your doctor prepare</h4>
                    <p>Optional, but it means less to explain in person</p>
                  </div>
                </div>
                <Field label="What brings you in today?" value={intake.symptoms} onChange={(v) => setIntake({ ...intake, symptoms: v })} textarea rows={2} />
                <Field label="How long has this been happening?" value={intake.durationText} onChange={(v) => setIntake({ ...intake, durationText: v })} />
                <label className="field"><span>Severity <strong>{intake.severity}/10</strong></span><input type="range" min="1" max="10" value={intake.severity} onChange={(e) => setIntake({ ...intake, severity: Number(e.target.value) })} /></label>
                <Field label="Existing conditions" value={intake.existingConditions} onChange={(v) => setIntake({ ...intake, existingConditions: v })} textarea rows={2} />
                <Field label="Current medications" value={intake.currentMedications} onChange={(v) => setIntake({ ...intake, currentMedications: v })} textarea rows={2} />
                <Field label="Anything else your doctor should know?" value={intake.additionalNotes} onChange={(v) => setIntake({ ...intake, additionalNotes: v })} textarea rows={2} />
              </div>
              <div className="modal-actions" style={{ justifyContent: 'flex-start', marginTop: 4 }}>
                <button className="primary-btn" disabled={booking} onClick={confirmBooking}>{booking ? 'Booking…' : 'Confirm booking'}</button>
                <button type="button" className="secondary-btn" disabled={booking} onClick={() => { setSelectedSlot(null); setReason(''); setIntake(emptyIntakeForm()); setError(''); }}>Choose another time</button>
              </div>
              <p className="muted" style={{ marginTop: 16, fontSize: '.78rem' }}>Clinical information is only visible to you and your care team. You can still add or edit these details from the appointment later.</p>
            </>
          ) : (
            <>
              <p className="eyebrow">Before you book</p>
              <h3>Make the most of your visit</h3>
              <p>Pick a date and time on the left. You'll review the details — including your reason for visiting — before the booking is made.</p>
            </>
          )}
        </aside>
      </div>
    </>
  );
}

function Schedule() {
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [hours, setHours] = useState<WorkingHour[]>([]);
  const [leave, setLeave] = useState<Leave[]>([]);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.doctorMe().then((d) => {
      setDoctor(d.doctor);
      return Promise.all([api.workingHours(d.doctor.id), api.leave(d.doctor.id)]);
    }).then(([h, l]) => { setHours(h.workingHours); setLeave(l.leave); }).catch(() => undefined);
  }, []);
  const save = async () => {
    if (!doctor) return;
    setBusy(true);
    setError('');
    try {
      const d = await api.saveWorkingHours(doctor.id, hours.map((h) => ({ dayOfWeek: h.dayOfWeek, startMinute: h.startMinute, endMinute: h.endMinute })));
      setHours(d.workingHours);
      setSaved('Working hours saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save working hours.');
    } finally {
      setBusy(false);
    }
  };
  if (!doctor) return <Loading />;
  return (
    <>
      <PageHeading eyebrow="Your schedule" title="Make room for care" description="Set the hours patients can book and protect time away from the clinic." action={<button className="primary-btn" onClick={save} disabled={busy}><Check size={17} />{busy ? 'Saving…' : 'Save changes'}</button>} />
      {saved && <div className="alert success"><Check size={17} />{saved}</div>}
      {error && <div className="alert error">{error}</div>}
      <div className="schedule-layout">
        <section className="panel">
          <PanelHeading icon={<Clock3 size={18} />} title="Working hours" />
          <WorkingHoursEditor hours={hours} setHours={setHours} />
        </section>
        <LeavePanel doctorId={doctor.id} leave={leave} setLeave={setLeave} />
      </div>
    </>
  );
}
function LeavePanel({ doctorId, leave, setLeave }: { doctorId: string; leave: Leave[]; setLeave: (l: Leave[]) => void }) {
  const [form, setForm] = useState({ startDate: '', startTime: '', endDate: '', endTime: '', reason: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // The backend requires a full ISO datetime with an offset
      // (z.iso.datetime({ offset: true })); a native date+time pair has
      // neither by itself, so combine them and let Date interpret it in the
      // browser's local time before converting to the UTC string the API
      // expects — same interpretation a single datetime-local input used to
      // give, just built from two plain fields instead of one native widget.
      const d = await api.addLeave(doctorId, {
        startsAt: new Date(`${form.startDate}T${form.startTime}`).toISOString(),
        endsAt: new Date(`${form.endDate}T${form.endTime}`).toISOString(),
        reason: form.reason,
      });
      setLeave([...leave, d.leave]);
      setForm({ startDate: '', startTime: '', endDate: '', endTime: '', reason: '' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add this leave period.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (leaveId: string) => {
    setDeletingId(leaveId);
    setError('');
    try {
      await api.deleteLeave(doctorId, leaveId);
      setLeave(leave.filter((l) => l.id !== leaveId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove this leave period.');
    } finally {
      setDeletingId('');
    }
  };

  return (
    <section className="panel">
      <PanelHeading icon={<CalendarDays size={18} />} title="Leave" />
      {error && <div className="alert error">{error}</div>}
      <div className="intake-block">
        <div className="intake-block-heading">
          <div className="panel-icon small"><Plus size={15} /></div>
          <div>
            <h4>Schedule time off</h4>
            <p>Patients won't be able to book appointments in this window</p>
          </div>
        </div>
        <form className="stack-form" onSubmit={submit}>
          <div className="form-row">
            <Field label="Starts (date)" type="date" value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} required />
            <Field label="Starts (time)" type="time" value={form.startTime} onChange={(v) => setForm({ ...form, startTime: v })} required />
          </div>
          <div className="form-row">
            <Field label="Ends (date)" type="date" value={form.endDate} onChange={(v) => setForm({ ...form, endDate: v })} required />
            <Field label="Ends (time)" type="time" value={form.endTime} onChange={(v) => setForm({ ...form, endTime: v })} required />
          </div>
          <Field label="Reason (optional)" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} />
          <button className="secondary-btn compact-btn" disabled={busy}><Plus size={16} />{busy ? 'Adding…' : 'Add leave'}</button>
        </form>
      </div>
      {leave.length ? (
        <div className="leave-list">
          {leave.map((item) => (
            <div className="leave-item" key={item.id}>
              <div>
                <strong>{formatDate(item.startsAt)}</strong>
                <span>{formatDate(item.endsAt)}{item.reason ? ` · ${item.reason}` : ''}</span>
              </div>
              <button className="icon-btn" disabled={deletingId === item.id} onClick={() => remove(item.id)}><X size={16} /></button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 22 }}><Empty title="No leave scheduled" body="Time off you add will show up here, and patients won't be able to book during it." /></div>
      )}
    </section>
  );
}

const GOOGLE_CALLBACK_MESSAGES: Record<string, { tone: 'success' | 'error'; text: string }> = {
  connected: { tone: 'success', text: 'Google Calendar is connected.' },
  denied: { tone: 'error', text: 'Google Calendar connection was cancelled.' },
  error: { tone: 'error', text: 'Something went wrong connecting Google Calendar. Please try again.' },
};

function SettingsPage({ user }: { user: User }) {
  const [status, setStatus] = useState<{ connected: boolean; googleEmail?: string; connectedAt?: string } | null>(null);
  const params = new URLSearchParams(window.location.search);
  useEffect(() => { if (user.role !== 'ADMIN') api.googleStatus().then(setStatus).catch(() => undefined); }, [user.role]);
  const callbackResult = params.get('google');
  const callbackMessage = callbackResult ? GOOGLE_CALLBACK_MESSAGES[callbackResult] : undefined;
  return (
    <>
      <PageHeading eyebrow="Account" title="Settings" description="Keep your profile and connected care tools up to date." />
      <div className="settings-layout">
        <section className="panel">
          <PanelHeading icon={<UserRound size={18} />} title="Profile" />
          <DetailRow label="Full name" value={user.fullName} />
          <DetailRow label="Email" value={user.email} />
          <DetailRow label="Phone" value={user.phone || 'Not provided'} />
          <DetailRow label="Timezone" value={user.timezone || 'Not provided'} />
        </section>
        {user.role !== 'ADMIN' && (
          <section className="panel">
            <PanelHeading icon={<CalendarDays size={18} />} title="Google Calendar" />
            {callbackMessage && <div className={`alert ${callbackMessage.tone}`}>{callbackMessage.text}</div>}
            <p className="muted">Keep your MediFlow appointments in sync with your personal calendar.</p>
            {status?.connected ? (
              <>
                <div className="connected-row"><Check size={17} /><div><strong>Connected</strong><span>{status.googleEmail || 'Google Calendar'}</span>{status.connectedAt && <span className="muted" style={{ display: 'block', fontSize: '.78rem' }}>Since {formatDate(status.connectedAt)}</span>}</div></div>
                <button className="secondary-btn" onClick={() => api.googleDisconnect().then(() => setStatus({ connected: false }))}>Disconnect</button>
              </>
            ) : (
              <button className="primary-btn" onClick={() => api.googleConnect().then((d) => { window.location.href = d.url; })}>Connect Google Calendar <ArrowRight size={16} /></button>
            )}
          </section>
        )}
      </div>
    </>
  );
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="heading-description">{description}</p></div>{action && <div className="heading-action">{action}</div>}</div>; }
function PanelHeading({ icon, title, action }: { icon: React.ReactNode; title: string; action?: React.ReactNode }) { return <div className="panel-heading"><div className="panel-icon">{icon}</div><h3>{title}</h3>{action && <div className="panel-heading-action">{action}</div>}</div>; }
function DetailRow({ label, value }: { label: string; value: string }) { return <div className="detail-row"><span>{label}</span><strong>{value}</strong></div>; }
function Field({ label, value, onChange, type = 'text', textarea = false, required = false, rows = 3 }: { label: string; value: string; onChange: (value: string) => void; type?: string; textarea?: boolean; required?: boolean; rows?: number }) { return <label className="field"><span>{label}</span>{textarea ? <textarea value={value} onChange={(e) => onChange(e.target.value)} required={required} rows={rows} /> : <input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} />}</label>; }
function Stat({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: string }) { return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong></div></div>; }
function StatusBadge({ status }: { status: Appointment['status'] }) { return <span className={`status-badge ${status.toLowerCase()}`}>{statusLabel(status)}</span>; }
function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) { return <div className="empty-state"><div className="empty-icon"><CalendarDays size={21} /></div><h3>{title}</h3><p>{body}</p>{action}</div>; }
function Loading() { return <div className="loading-state"><div className="spinner" /><span>Loading your care workspace…</span></div>; }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={(e) => e.stopPropagation()}><div className="modal-heading"><h2>{title}</h2><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>{children}</div></div>; }
function minutesToTime(minutes: number) { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; }
function timeToMinutes(value: string) { const [h, m] = value.split(':').map(Number); return h * 60 + m; }

export default App;
