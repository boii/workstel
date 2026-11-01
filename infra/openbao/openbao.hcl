ui = false
api_addr = "https://workstel-openbao:8200"
cluster_addr = "https://workstel-openbao:8201"
listener "tcp" {
  address = "0.0.0.0:8200"
  tls_cert_file = "/openbao/tls/server.crt"
  tls_key_file = "/openbao/tls/server.key"
  tls_min_version = "tls12"
  max_request_size = 65536
}
storage "raft" {
  path = "/openbao/data"
  node_id = "workstel-hotel-1"
}
audit "file" "workstel" {
  description = "Workstel encrypted secret operations"
  options {
    file_path = "/openbao/logs/audit.jsonl"
    log_raw = "false"
  }
}
