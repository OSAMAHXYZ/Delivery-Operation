(() => {
  const { api, esc } = window.DTX;
  const $ = (id) => document.getElementById(id);

  function setStatus(msg, type) {
    const el = $('formStatus');
    el.textContent = msg || '';
    el.className = 'status' + (type ? ` ${type}` : '');
  }

  function showSuccess(entry) {
    $('okCompany').textContent = entry.company;
    $('okName').textContent = entry.name;
    $('okPhone').textContent = entry.phone;
    $('okTime').textContent = new Date(entry.at).toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' });
    $('formCard').classList.add('hidden');
    $('successCard').classList.remove('hidden');
  }

  function showForm() {
    $('attendanceForm').reset();
    setStatus('');
    $('successCard').classList.add('hidden');
    $('formCard').classList.remove('hidden');
    $('company').focus();
  }

  async function boot() {
    const meta = await api('/meta');
    const companies = meta.carriers || [];
    $('company').innerHTML = '<option value="">— اختر الشركة —</option>'
      + companies.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

    $('attendanceForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const company = $('company').value.trim();
      const name = $('name').value.trim();
      const phone = $('phone').value.trim();
      if (!company) { setStatus('اختر الشركة من القائمة', 'err'); $('company').focus(); return; }
      if (name.length < 2) { setStatus('أدخل الاسم', 'err'); $('name').focus(); return; }
      if (!phone) { setStatus('أدخل رقم الجوال', 'err'); $('phone').focus(); return; }
      const btn = $('btnSubmit');
      btn.disabled = true;
      setStatus('جاري التسجيل…');
      try {
        const data = await api('/attendance', { method: 'POST', json: { company, name, phone } });
        showSuccess(data.entry);
      } catch (err) {
        setStatus(err.message || 'فشل التسجيل', 'err');
      } finally {
        btn.disabled = false;
      }
    });

    $('btnAgain').addEventListener('click', showForm);
  }

  boot().catch((e) => setStatus(e.message || 'تعذر تحميل قائمة الشركات', 'err'));
})();
