# A single eventlet worker owns all Euchre tables, locks, and bot/expiry timers.
worker_class = "eventlet"
workers = 1
bind = "0.0.0.0:5002"
graceful_timeout = 10
accesslog = "-"
errorlog = "-"
access_log_format = "%(h)s %(m)s %(U)s %(s)s %(L)s"
