import os
import re
import json
import base64
import urllib.request
import urllib.error
import sys

def main():
    jira_base_url = os.environ.get("JIRA_BASE_URL", "https://cotuong69.atlassian.net").rstrip("/")
    jira_email = os.environ.get("JIRA_USER_EMAIL")
    jira_api_token = os.environ.get("JIRA_API_TOKEN")

    event_name = os.environ.get("GITHUB_EVENT_NAME", "")
    ref_type = os.environ.get("REF_TYPE", "")
    ref_name = os.environ.get("REF_NAME", "")
    pr_title = os.environ.get("PR_TITLE", "")
    pr_body = os.environ.get("PR_BODY", "")
    pr_merged = os.environ.get("PR_MERGED", "false").lower() == "true"
    commit_messages = os.environ.get("COMMIT_MESSAGES", "")
    input_issue = os.environ.get("INPUT_ISSUE_KEY", "")
    input_transition = os.environ.get("INPUT_TRANSITION_ID", "")
    repository = os.environ.get("REPOSITORY") or os.environ.get("GITHUB_REPOSITORY", "")
    pr_head_repo = os.environ.get("PR_HEAD_REPO", "")
    project_key = (os.environ.get("JIRA_PROJECT_KEY") or "COT").strip().upper() or "COT"

    clean_ref = ref_name.replace("refs/heads/", "").strip()

    # SEC-04: chỉ xử lý PR được mở từ chính repository này. PR từ fork có thể
    # đặt tiêu đề bất kỳ nên không được phép chuyển trạng thái issue Jira.
    if event_name == "pull_request_target":
        if not pr_head_repo:
            print("Không xác định được repo nguồn của PR — bỏ qua (fail-safe).")
            return
        if repository and pr_head_repo != repository:
            print(f"PR đến từ fork ({pr_head_repo} != {repository}) — bỏ qua, không chuyển trạng thái Jira.")
            return

    print(f"Triggered by event: {event_name}")
    print(f"Ref name: {ref_name} (clean: {clean_ref}, type: {ref_type})")
    print(f"PR title: {pr_title}")
    print(f"PR merged: {pr_merged}")

    # Nhận diện hành vi Revert Pull Request / Commit
    is_revert = bool(
        re.search(r'\brevert\b', pr_title, re.IGNORECASE) or
        re.search(r'\brevert\b', ref_name, re.IGNORECASE) or
        re.search(r'\brevert\b', commit_messages, re.IGNORECASE)
    )
    if is_revert:
        print("ℹ️ Phát hiện thao tác REVERT Pull Request / Commit.")

    transition_id = None
    text_to_search = f"{ref_name} {pr_title} {pr_body} {commit_messages} {input_issue}"

    if event_name == "workflow_dispatch":
        transition_id = input_transition
    elif event_name == "create":
        # Khi tạo branch mới -> Chuyển sang READY FOR DEV (ID: 61)
        if ref_type == "branch":
            transition_id = "61"
        else:
            print(f"Event 'create' with ref_type='{ref_type}' is not a branch creation. Exiting.")
            return
    elif event_name == "push":
        # Nếu push trực tiếp vào main hoặc master -> Chủ repo đưa code vào mainline -> DONE (ID: 31)
        if clean_ref in ["main", "master"]:
            transition_id = "31"
            print(f"Push trực tiếp vào nhánh chính '{clean_ref}' -> Tự động chuyển Jira task sang DONE (ID: 31)")
        else:
            # Khi push commit vào feature branch -> Chuyển sang IN PROGRESS (ID: 21)
            transition_id = "21"
    elif event_name in ["pull_request", "pull_request_target"]:
        pr_action = os.environ.get("PR_ACTION", "")
        if is_revert:
            # Khi mở Revert PR hoặc khi merge Revert PR -> Lùi task về IN PROGRESS (ID: 21)
            if pr_action in ["opened", "reopened"] or (pr_action == "closed" and pr_merged):
                transition_id = "21"
                print(f"Revert PR (action: {pr_action}, merged: {pr_merged}) -> Lùi trạng thái task về IN PROGRESS (ID: 21)")
            else:
                print(f"Revert PR action '{pr_action}' (merged={pr_merged}) không khớp điều kiện lùi trạng thái. Exiting.")
                return
        else:
            if pr_action in ["opened", "reopened"]:
                # Khi mở PR thông thường -> Chuyển sang READY FOR TEST (ID: 71)
                transition_id = "71"
            elif pr_action == "closed" and pr_merged:
                # Khi merge PR thông thường -> Chuyển sang DONE (ID: 31)
                transition_id = "31"
            else:
                print(f"PR action '{pr_action}' (merged={pr_merged}) does not match transition trigger criteria. Exiting.")
                return
    else:
        print(f"Unhandled event: {event_name}. Exiting.")
        return

    # SEC-04: chỉ nhận Issue Key đúng project key (mặc định COT-xxx).
    # Regex cũ nhận mọi tiền tố nên PR có thể trỏ sang issue của project khác.
    allowed_transitions = {"11", "21", "31", "61", "71"}
    if transition_id is not None and str(transition_id) not in allowed_transitions:
        print(f"::error::Transition ID '{transition_id}' không hợp lệ (chỉ chấp nhận {sorted(allowed_transitions)}).")
        sys.exit(1)

    if event_name == "workflow_dispatch" and input_issue:
        if not re.fullmatch(rf"{re.escape(project_key)}-\d+", input_issue.strip(), re.IGNORECASE):
            print(f"::error::Issue Key '{input_issue}' không hợp lệ (phải có dạng {project_key}-<số>).")
            sys.exit(1)

    key_pattern = re.compile(rf"\b{re.escape(project_key)}-\d+\b", re.IGNORECASE)
    valid_matches = [m.upper() for m in key_pattern.findall(text_to_search)]
    if not valid_matches:
        print(f"Không tìm thấy Jira Issue Key '{project_key}-<số>' trong: '{text_to_search}'. Exiting.")
        return

    unique_keys = list(dict.fromkeys(valid_matches))
    print(f"Found Jira Issue Keys: {unique_keys}")
    print(f"Target transition ID: {transition_id}")

    if not jira_email or not jira_api_token:
        print("::error::Missing JIRA_USER_EMAIL or JIRA_API_TOKEN secret. Please configure them in GitHub repository Secrets.")
        sys.exit(1)

    auth_str = f"{jira_email}:{jira_api_token}"
    auth_b64 = base64.b64encode(auth_str.encode("utf-8")).decode("utf-8")
    headers = {
        "Authorization": f"Basic {auth_b64}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "GitHub-Actions-Jira-Sync"
    }

    status_name_map = {
        "21": "in progress",
        "31": "done",
        "61": "ready for dev",
        "71": "ready for test",
        "11": "to do"
    }

    for issue_key in unique_keys:
        url = f"{jira_base_url}/rest/api/3/issue/{issue_key}/transitions"
        target_id_str = str(transition_id)
        try:
            get_req = urllib.request.Request(url, headers=headers, method="GET")
            with urllib.request.urlopen(get_req) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                available = data.get("transitions", [])
                valid_ids = [t["id"] for t in available]
                formatted = [f"{t['name']} ({t['id']})" for t in available]
                print(f"Available transitions for {issue_key}: {formatted}")
                if target_id_str not in valid_ids:
                    wanted = status_name_map.get(target_id_str, "")
                    matched = next((t["id"] for t in available if wanted in t.get("name", "").lower() or wanted in t.get("to", {}).get("name", "").lower()), None)
                    if matched:
                        print(f"Đã tự động ánh xạ trạng thái '{wanted}' sang Transition ID {matched}")
                        target_id_str = matched
                    else:
                        print(f"ℹ️ Issue {issue_key} hiện không có transition '{wanted}' (có thể đã ở trạng thái này rồi). Bỏ qua.")
                        continue
        except Exception as e:
            print(f"Notice: Không thể truy vấn danh sách transition trước ({e}), dùng Transition ID mặc định {target_id_str}")

        payload = json.dumps({"transition": {"id": target_id_str}}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req) as response:
                if response.status in (200, 204):
                    print(f"✅ Successfully transitioned {issue_key} to transition ID {target_id_str}!")
                else:
                    print(f"⚠️ Jira API responded with status {response.status}")
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8")
            print(f"⚠️ Jira API Notice for {issue_key} HTTP {e.code}: {e.reason} -> {error_body}")
        except Exception as e:
            print(f"⚠️ Unexpected error for {issue_key}: {str(e)}")

if __name__ == "__main__":
    main()
