from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

_scheduler = AsyncIOScheduler(timezone="UTC")


def setup_scheduler(async_func, interval_hours: int):
    _scheduler.add_job(
        async_func,
        trigger="interval",
        hours=interval_hours,
        id="automation",
        replace_existing=True,
        next_run_time=datetime.now(timezone.utc),
    )
    _scheduler.start()


def stop_scheduler():
    if _scheduler.running:
        _scheduler.shutdown()


def get_job_info() -> dict:
    job = _scheduler.get_job("automation")
    return {
        "next_run": job.next_run_time.isoformat() if job and job.next_run_time else None,
        "running": _scheduler.running,
    }
